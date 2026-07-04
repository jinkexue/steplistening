// ============================================================
// POST /api/celpip/speaking/submit
// 上传录音 → 存 R2 → STT 转写 → LLM 反馈 → 落 attempts
// multipart/form-data:
//   file:      音频文件
//   user_id:   int
//   paper_id:  int
//   item_id:   int
// 返回：{ audio_key, transcript, feedback:{fluency, grammar, vocabulary, overall_clb, suggestions[]} }
// ============================================================

import { requireUser, json } from "../../../lib/auth.js";
import { loadSettings, volcChatJSON, pickEndpoint, pickModel } from "../../../lib/volc.js";

async function sha256Hex(text) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function stt(env, settings, audioBytes, filename) {
  const provider = (settings.stt_provider || "cloudflare").toLowerCase();
  if (provider === "volc") {
    const model = pickModel(settings, "volc_stt");
    const endpoint = pickEndpoint(settings, "volc_stt");
    if (!model) throw new Error("volc_stt_model not configured");
    const base = endpoint.replace(/\/+$/, "");
    const form = new FormData();
    form.append("file", new Blob([audioBytes]), filename || "audio.webm");
    form.append("model", model);
    const resp = await fetch(`${base}/audio/transcriptions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.VOLC_API_KEY}` },
      body: form,
    });
    if (!resp.ok) throw new Error(`volc STT ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    return data?.text || "";
  }
  const model = pickModel(settings, "cf_stt") || "@cf/openai/whisper";
  const res = await env.AI.run(model, { audio: [...audioBytes] });
  return res?.text || res?.transcript || "";
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const guard = await requireUser(request, env);
  if (!guard.ok) return guard.response;

  try {
    if (!env.VOLC_API_KEY) return json({ error: "VOLC_API_KEY missing" }, 500);
    const form = await request.formData();
    const file = form.get("file");
    const paperId = Number(form.get("paper_id"));
    const itemId = Number(form.get("item_id"));
    if (!file) return json({ error: "file required" }, 400);
    if (!paperId || !itemId) return json({ error: "paper_id / item_id required" }, 400);

    const item = await env.DB.prepare("SELECT * FROM celpip_speaking_items WHERE id = ?").bind(itemId).first();
    if (!item) return json({ error: "speaking item not found" }, 404);

    const audioBytes = new Uint8Array(await file.arrayBuffer());
    const mime = file.type || "audio/webm";
    const ext = mime.includes("mp4") ? "m4a" : (mime.includes("wav") ? "wav" : "webm");
    const hash = await sha256Hex(`${guard.user.id}|${itemId}|${Date.now()}`);
    const audioKey = `celpip/speaking/attempts/${guard.user.id}/${hash}.${ext}`;
    await env.BUCKET.put(audioKey, audioBytes, { httpMetadata: { contentType: mime } });

    // STT
    const settings = await loadSettings(env.DB);
    let transcript = "";
    let sttError = null;
    try {
      transcript = await stt(env, settings, audioBytes, `speech.${ext}`);
    } catch (e) {
      sttError = e.message;
    }

    // LLM 反馈
    let feedback = null;
    let feedbackError = null;
    if (transcript) {
      try {
        const promptRow = await env.DB.prepare(
          "SELECT system_prompt FROM celpip_prompts WHERE section='scoring' AND name='speaking_feedback' AND active=1 ORDER BY version DESC LIMIT 1"
        ).first();
        const systemPrompt = promptRow?.system_prompt || [
          "You are an official CELPIP Speaking examiner.",
          "Given the transcript and record duration, evaluate fluency (proxy: words/sec),",
          "grammar errors, and lexical diversity.",
          "Return strict JSON: {fluency, grammar, vocabulary, overall_clb, suggestions:[...]}.",
          "Also list top 3 improvements with concrete rewrites.",
        ].join("\n");

        const userMsg = JSON.stringify({
          task: item.task,
          prompt: item.prompt,
          vision_hints: item.vision_hints ? safeParse(item.vision_hints) : null,
          transcript,
          record_seconds: item.record_seconds || 60,
          word_count: transcript.trim() ? transcript.trim().split(/\s+/).length : 0,
        });

        feedback = await volcChatJSON({
          apiKey: env.VOLC_API_KEY,
          endpoint: pickEndpoint(settings, "llm"),
          model: pickModel(settings, "llm"),
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMsg },
          ],
          max_tokens: 2000,
        });
      } catch (e) {
        feedbackError = e.message;
      }
    }

    // 落 attempts
    await env.DB.prepare(
      `INSERT INTO celpip_attempts
        (paper_id, user_id, section, item_id, audio_key, transcript, score_json, status, updated_at)
       VALUES (?, ?, 'speaking', ?, ?, ?, ?, 'graded', CURRENT_TIMESTAMP)
       ON CONFLICT(paper_id, user_id, section, item_id)
       DO UPDATE SET
         audio_key = excluded.audio_key,
         transcript = excluded.transcript,
         score_json = excluded.score_json,
         status = 'graded',
         updated_at = CURRENT_TIMESTAMP`
    ).bind(paperId, guard.user.id, itemId, audioKey, transcript,
           feedback ? JSON.stringify(feedback) : null).run();

    return json({
      audio_key: audioKey,
      transcript,
      feedback,
      stt_error: sttError,
      feedback_error: feedbackError,
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
