// ============================================================
// POST /api/interview_tts
// 为面试回答生成 TTS 音频（使用 Cloudflare Workers AI 免费 TTS）
// 缓存到 R2: interview/tts/<hash>.mp3
// 请求：{ id, text, voice? }
//   - id: interview_audios.id（保存 tts_audio_key）
//   - text: 要合成的文本
//   - voice: 音色（可选，默认 alloy）
// 响应：{ audio_key, cached, voice }
// ============================================================

// Cloudflare Workers AI TTS - 使用 MeloTTS 免费模型
// 支持的音色：https://developers.cloudflare.com/workers-ai/models/melotts/
const CF_TTS_MODEL = "@cf/myshell-ai/melotts";

async function sha256Hex(text) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function normalizeAudioResponse(res) {
  if (res instanceof ReadableStream) {
    const reader = res.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    return new Blob(chunks);
  }
  if (res?.audio) {
    const bin = atob(res.audio);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  if (res instanceof ArrayBuffer || res instanceof Uint8Array) return res;
  throw new Error("Unknown TTS response format");
}

// 支持的音色映射（MeloTTS 支持多语言，采用语言代码作为 lang 参数）
// 语言代码 → 展示名
const VOICE_MAP = {
  "en-us":     { lang: "en-us", label: "English (US)" },
  "en-br":     { lang: "en-br", label: "English (British)" },
  "en-au":     { lang: "en-au", label: "English (Australian)" },
  "en-india":  { lang: "en-india", label: "English (Indian)" },
  "en-default":{ lang: "en-default", label: "English (Default)" },
  "es":        { lang: "es", label: "Spanish" },
  "fr":        { lang: "fr", label: "French" },
  "zh":        { lang: "zh", label: "Chinese" },
  "jp":        { lang: "jp", label: "Japanese" },
  "kr":        { lang: "kr", label: "Korean" },
};

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const { id, text, voice } = body || {};
    if (!text || !text.trim()) {
      return new Response(JSON.stringify({ error: "text required" }), { status: 400 });
    }

    // 校验 / 选择音色（默认 en-us）
    const voiceKey = (voice || "en-us").toLowerCase();
    const voiceCfg = VOICE_MAP[voiceKey] || VOICE_MAP["en-us"];
    const finalVoice = VOICE_MAP[voiceKey] ? voiceKey : "en-us";

    const cacheKey = await sha256Hex(`interview|melotts|${finalVoice}|${text.trim()}`);
    const r2Key = `interview/tts/${cacheKey}.mp3`;

    // 命中缓存
    const head = await env.BUCKET.head(r2Key);
    let cached = false;
    if (head) {
      cached = true;
    } else {
      const res = await env.AI.run(CF_TTS_MODEL, {
        prompt: text.trim(),
        lang: voiceCfg.lang,
      });
      const bytes = await normalizeAudioResponse(res);
      await env.BUCKET.put(r2Key, bytes, {
        httpMetadata: { contentType: "audio/mpeg" },
      });
    }

    // 更新数据库
    if (id) {
      try {
        await env.DB.prepare(
          "UPDATE interview_audios SET tts_audio_key = ?, tts_voice = ? WHERE id = ?"
        ).bind(r2Key, finalVoice, id).run();
      } catch (dbErr) {
        console.error('update interview_audios tts fields failed:', dbErr);
      }
    }

    return new Response(JSON.stringify({
      audio_key: r2Key,
      cached,
      voice: finalVoice,
    }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error('interview_tts error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

// GET 返回支持的音色列表
export async function onRequestGet() {
  const voices = Object.entries(VOICE_MAP).map(([key, v]) => ({
    key,
    label: v.label,
  }));
  return new Response(JSON.stringify({ voices }), {
    headers: { "Content-Type": "application/json" },
  });
}
