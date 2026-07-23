// ============================================================
// POST /api/interview_tts
// 为面试回答生成 TTS 音频（Cloudflare Workers AI 神经元 TTS）
// 支持模型：aura-1（默认，$0.015/1k chars） / aura-2（$0.03/1k chars）
// 音色：6 个北美英语 speaker
// 缓存：R2 interview/tts/<hash>.mp3（hash = model + speaker + text）
// 请求：{ id?, text, model?, voice? }
// 响应：{ audio_key, cached, voice, model }
// ============================================================

// 两个 Deepgram 模型 ID
const MODEL_MAP = {
  "aura-1": "@cf/deepgram/aura-1",
  "aura-2": "@cf/deepgram/aura-2-en",
};

// 6 个北美英语音色白名单（Aura-1 与 Aura-2 都支持）
const VOICE_WHITELIST = ["luna", "asteria", "hera", "arcas", "orion", "zeus"];

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
  if (res instanceof Response) return await res.arrayBuffer();
  throw new Error("Unknown TTS response format");
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const { id, text, model, voice } = body || {};
    if (!text || !text.trim()) {
      return new Response(JSON.stringify({ error: "text required" }), { status: 400 });
    }

    // 模型校验
    const modelKey = (model || "aura-1").toLowerCase();
    const modelId = MODEL_MAP[modelKey];
    if (!modelId) {
      return new Response(JSON.stringify({ error: `unsupported model: ${modelKey}` }), { status: 400 });
    }

    // 音色校验
    const speaker = VOICE_WHITELIST.includes((voice || "").toLowerCase())
      ? voice.toLowerCase()
      : "luna";

    // 缓存 key（模型 + 音色 + 文本）
    const cacheKey = await sha256Hex(`interview|${modelKey}|${speaker}|${text.trim()}`);
    const r2Key = `interview/tts/${cacheKey}.mp3`;

    // 命中缓存
    const head = await env.BUCKET.head(r2Key);
    let cached = false;
    if (head) {
      cached = true;
    } else {
      // 调用 Deepgram Aura 模型
      const res = await env.AI.run(modelId, {
        text: text.trim(),
        speaker,
        encoding: "mp3",
      });
      const bytes = await normalizeAudioResponse(res);
      await env.BUCKET.put(r2Key, bytes, {
        httpMetadata: { contentType: "audio/mpeg" },
      });
    }

    // 更新数据库（记录最近使用的 model / voice / audio_key）
    if (id) {
      try {
        await env.DB.prepare(
          "UPDATE interview_audios SET tts_audio_key = ?, tts_voice = ?, tts_model = ? WHERE id = ?"
        ).bind(r2Key, speaker, modelKey, id).run();
      } catch (dbErr) {
        // 若 tts_model 字段还没迁移，退化到只更新前两列
        try {
          await env.DB.prepare(
            "UPDATE interview_audios SET tts_audio_key = ?, tts_voice = ? WHERE id = ?"
          ).bind(r2Key, speaker, id).run();
        } catch (e2) {
          console.error("update interview_audios tts fields failed:", e2);
        }
      }
    }

    return new Response(JSON.stringify({
      audio_key: r2Key,
      cached,
      voice: speaker,
      model: modelKey,
    }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("interview_tts error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

// GET 返回支持的模型与音色列表
export async function onRequestGet() {
  return new Response(JSON.stringify({
    models: [
      { key: "aura-1", label: "💰 Aura-1", desc: "自然，性价比高（$0.015/1k）" },
      { key: "aura-2", label: "💎 Aura-2", desc: "最自然（$0.03/1k）" },
    ],
    voices: [
      { key: "luna",    label: "🌙 Luna",    gender: "F", desc: "友好、清晰（默认）" },
      { key: "asteria", label: "✨ Asteria", gender: "F", desc: "明亮、有活力" },
      { key: "hera",    label: "💼 Hera",    gender: "F", desc: "商务、专业" },
      { key: "arcas",   label: "🎯 Arcas",   gender: "M", desc: "自然对话感" },
      { key: "orion",   label: "🔥 Orion",   gender: "M", desc: "低沉、有磁性" },
      { key: "zeus",    label: "⚡ Zeus",    gender: "M", desc: "权威、有力量" },
    ],
    rates: [
      { key: "0.75", label: "🐢 0.75×" },
      { key: "1.0",  label: "▶️ 1.0×" },
      { key: "1.25", label: "⏩ 1.25×" },
      { key: "1.5",  label: "⚡ 1.5×" },
    ],
  }), {
    headers: { "Content-Type": "application/json" },
  });
}
