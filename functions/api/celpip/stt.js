// ============================================================
// POST /api/celpip/stt
// 音频 → 文本（Cloudflare Whisper 优先）
// 两种输入：
//   1) multipart/form-data: file
//   2) application/json: { audio_key }  从 R2 拿
// ============================================================

import { requireUser, json } from "../../lib/auth.js";
import { loadSettings } from "../../lib/volc.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  const guard = await requireUser(request, env);
  if (!guard.ok) return guard.response;

  try {
    const settings = await loadSettings(env.DB);
    const model = settings.cf_stt_model || "@cf/openai/whisper";

    let audioBytes;
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("multipart/form-data")) {
      const form = await request.formData();
      const f = form.get("file");
      if (!f) return json({ error: "file required" }, 400);
      audioBytes = new Uint8Array(await f.arrayBuffer());
    } else {
      const { audio_key } = await request.json();
      if (!audio_key) return json({ error: "audio_key required" }, 400);
      const obj = await env.BUCKET.get(audio_key);
      if (!obj) return json({ error: "audio not found in R2" }, 404);
      audioBytes = new Uint8Array(await obj.arrayBuffer());
    }

    const res = await env.AI.run(model, { audio: [...audioBytes] });
    const text = res?.text || res?.transcript || "";
    return json({ text, model });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
