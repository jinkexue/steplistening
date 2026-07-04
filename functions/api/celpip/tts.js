// ============================================================
// POST /api/celpip/tts
// 文本 → 音频
// 根据 settings.tts_provider 决定：
//   - 'cloudflare'（默认）→ 走 Workers AI（cf_tts_model）
//   - 'volc'              → 走火山方舟 TTS（volc_tts_endpoint + volc_tts_model）
// 结果统一缓存到 R2：celpip/tts/<hash>.mp3
// ============================================================

import { requireUser, json } from "../../lib/auth.js";
import { loadSettings, pickEndpoint, pickModel } from "../../lib/volc.js";

async function sha256Hex(text) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Cloudflare Workers AI TTS
 */
async function ttsViaCloudflare(env, model, text, voice, accent) {
  const res = await env.AI.run(model, { text, voice, accent });
  return normalizeAudioResponse(res);
}

/**
 * 火山方舟 TTS（OpenAI 兼容 /audio/speech）
 */
async function ttsViaVolc(env, endpoint, model, text, voice) {
  if (!env.VOLC_API_KEY) throw new Error("VOLC_API_KEY missing");
  const base = (endpoint || "").replace(/\/+$/, "");
  const url = `${base}/audio/speech`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.VOLC_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input: text, voice: voice || "alloy", response_format: "mp3" }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`volc TTS failed: ${resp.status} ${txt}`);
  }
  return new Uint8Array(await resp.arrayBuffer());
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

export async function onRequestPost(context) {
  const { request, env } = context;
  const guard = await requireUser(request, env);
  if (!guard.ok) return guard.response;

  try {
    const { text, voice, accent = "en-CA", forceRegenerate } = await request.json();
    if (!text) return json({ error: "text required" }, 400);

    const settings = await loadSettings(env.DB);
    const provider = (settings.tts_provider || "cloudflare").toLowerCase();

    let bytes;
    let cacheKey;
    if (provider === "volc") {
      const model = pickModel(settings, "volc_tts");
      const endpoint = pickEndpoint(settings, "volc_tts");
      if (!model) return json({ error: "volc_tts_model not configured" }, 500);
      cacheKey = await sha256Hex(`volc|${model}|${voice || ""}|${text}`);
      const r2Key = `celpip/tts/${cacheKey}.mp3`;
      if (!forceRegenerate) {
        const head = await env.BUCKET.head(r2Key);
        if (head) return json({ audio_key: r2Key, cached: true, provider });
      }
      bytes = await ttsViaVolc(env, endpoint, model, text, voice);
      await env.BUCKET.put(r2Key, bytes, { httpMetadata: { contentType: "audio/mpeg" } });
      return json({ audio_key: r2Key, cached: false, provider });
    }

    // cloudflare
    const model = pickModel(settings, "cf_tts") || "@cf/deepgram/aura-2-en";
    cacheKey = await sha256Hex(`cf|${model}|${voice || ""}|${accent}|${text}`);
    const r2Key = `celpip/tts/${cacheKey}.mp3`;
    if (!forceRegenerate) {
      const head = await env.BUCKET.head(r2Key);
      if (head) return json({ audio_key: r2Key, cached: true, provider });
    }
    bytes = await ttsViaCloudflare(env, model, text, voice, accent);
    await env.BUCKET.put(r2Key, bytes, { httpMetadata: { contentType: "audio/mpeg" } });
    return json({ audio_key: r2Key, cached: false, provider });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
