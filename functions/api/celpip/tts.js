// ============================================================
// POST /api/celpip/tts
// 文本 → 音频（优先 Cloudflare Workers AI，兜底火山 TTS）
// 结果缓存到 R2：celpip/tts/<hash>.mp3
// body: { text, voice?, accent?, key? }
// ============================================================

import { requireUser, json } from "../../lib/auth.js";
import { loadSettings } from "../../lib/volc.js";

async function sha256Hex(text) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const guard = await requireUser(request, env);
  if (!guard.ok) return guard.response;

  try {
    const { text, voice, accent = "en-CA", forceRegenerate } = await request.json();
    if (!text) return json({ error: "text required" }, 400);

    const settings = await loadSettings(env.DB);
    const model = settings.cf_tts_model || "@cf/deepgram/aura-2-en";
    const hash = await sha256Hex(`${model}|${voice || ""}|${accent}|${text}`);
    const r2Key = `celpip/tts/${hash}.mp3`;

    // 命中缓存
    if (!forceRegenerate) {
      const head = await env.BUCKET.head(r2Key);
      if (head) return json({ audio_key: r2Key, cached: true });
    }

    // 调用 Cloudflare Workers AI
    let bytes;
    try {
      const res = await env.AI.run(model, { text, voice, accent });
      // Workers AI TTS 返回可能是 ReadableStream / ArrayBuffer / { audio }
      if (res instanceof ReadableStream) {
        const reader = res.getReader();
        const chunks = [];
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        bytes = new Blob(chunks);
      } else if (res?.audio) {
        // base64
        const bin = atob(res.audio);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        bytes = arr;
      } else if (res instanceof ArrayBuffer || res instanceof Uint8Array) {
        bytes = res;
      } else {
        throw new Error("Unknown TTS response format");
      }
    } catch (e) {
      return json({ error: `TTS failed: ${e.message}` }, 500);
    }

    await env.BUCKET.put(r2Key, bytes, {
      httpMetadata: { contentType: "audio/mpeg" },
    });
    return json({ audio_key: r2Key, cached: false });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
