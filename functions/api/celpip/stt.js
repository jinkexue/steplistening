// ============================================================
// POST /api/celpip/stt
// 音频 → 文本
// 根据 settings.stt_provider 决定：
//   - 'cloudflare'（默认）→ Workers AI Whisper
//   - 'volc'              → 火山方舟 STT（OpenAI 兼容 /audio/transcriptions）
// 输入：
//   multipart/form-data: file
//   或 application/json: { audio_key }（从 R2 拿）
// ============================================================

import { requireUser, json } from "../../lib/auth.js";
import { loadSettings, pickEndpoint, pickModel } from "../../lib/volc.js";

async function sttViaCloudflare(env, model, audioBytes) {
  const res = await env.AI.run(model, { audio: [...audioBytes] });
  return res?.text || res?.transcript || "";
}

async function sttViaVolc(env, endpoint, model, audioBytes, filename = "audio.webm") {
  if (!env.VOLC_API_KEY) throw new Error("VOLC_API_KEY missing");
  const base = (endpoint || "").replace(/\/+$/, "");
  const url = `${base}/audio/transcriptions`;
  const form = new FormData();
  form.append("file", new Blob([audioBytes]), filename);
  form.append("model", model);
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.VOLC_API_KEY}` },
    body: form,
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`volc STT failed: ${resp.status} ${txt}`);
  }
  const data = await resp.json();
  return data?.text || data?.transcript || "";
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const guard = await requireUser(request, env);
  if (!guard.ok) return guard.response;

  try {
    const settings = await loadSettings(env.DB);
    const provider = (settings.stt_provider || "cloudflare").toLowerCase();

    let audioBytes;
    let filename = "audio.webm";
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("multipart/form-data")) {
      const form = await request.formData();
      const f = form.get("file");
      if (!f) return json({ error: "file required" }, 400);
      audioBytes = new Uint8Array(await f.arrayBuffer());
      if (f.name) filename = f.name;
    } else {
      const { audio_key } = await request.json();
      if (!audio_key) return json({ error: "audio_key required" }, 400);
      const obj = await env.BUCKET.get(audio_key);
      if (!obj) return json({ error: "audio not found in R2" }, 404);
      audioBytes = new Uint8Array(await obj.arrayBuffer());
      filename = audio_key.split("/").pop() || "audio.webm";
    }

    let text = "";
    if (provider === "volc") {
      const model = pickModel(settings, "volc_stt");
      const endpoint = pickEndpoint(settings, "volc_stt");
      if (!model) return json({ error: "volc_stt_model not configured" }, 500);
      text = await sttViaVolc(env, endpoint, model, audioBytes, filename);
      return json({ text, provider, model });
    }
    const model = pickModel(settings, "cf_stt") || "@cf/openai/whisper";
    text = await sttViaCloudflare(env, model, audioBytes);
    return json({ text, provider, model });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
