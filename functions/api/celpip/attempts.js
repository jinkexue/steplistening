// ============================================================
// GET  /api/celpip/attempts?paper_id=&user_id=  -> 当前用户在该试卷的所有作答记录
// POST /api/celpip/attempts                      -> upsert 单题作答（断点续答）
// body: { user_id, paper_id, section, item_id, answer_json?, audio_key?, transcript?, essay?, score_json?, status? }
// ============================================================

import { requireUser, json } from "../../lib/auth.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const guard = await requireUser(request, env);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const paperId = url.searchParams.get("paper_id");
  if (!paperId) return json({ error: "paper_id required" }, 400);

  try {
    const rows = await env.DB.prepare(
      "SELECT * FROM celpip_attempts WHERE user_id = ? AND paper_id = ? ORDER BY updated_at DESC"
    ).bind(guard.user.id, paperId).all();
    return json({ attempts: rows.results });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const guard = await requireUser(request, env);
  if (!guard.ok) return guard.response;

  try {
    const data = await request.json();
    const {
      paper_id, section, item_id,
      answer_json, audio_key, transcript, essay, score_json,
      status,
    } = data;

    if (!paper_id || !section || !item_id) {
      return json({ error: "paper_id / section / item_id required" }, 400);
    }

    // upsert（依赖 uniq_celpip_attempts 唯一索引）
    await env.DB.prepare(
      `INSERT INTO celpip_attempts
        (paper_id, user_id, section, item_id, answer_json, audio_key, transcript, essay, score_json, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(paper_id, user_id, section, item_id)
       DO UPDATE SET
         answer_json = COALESCE(excluded.answer_json, celpip_attempts.answer_json),
         audio_key   = COALESCE(excluded.audio_key,   celpip_attempts.audio_key),
         transcript  = COALESCE(excluded.transcript,  celpip_attempts.transcript),
         essay       = COALESCE(excluded.essay,       celpip_attempts.essay),
         score_json  = COALESCE(excluded.score_json,  celpip_attempts.score_json),
         status      = COALESCE(excluded.status,      celpip_attempts.status),
         updated_at  = CURRENT_TIMESTAMP`
    ).bind(
      paper_id, guard.user.id, section, item_id,
      answer_json || null,
      audio_key || null,
      transcript || null,
      essay || null,
      score_json || null,
      status || "in_progress"
    ).run();

    return json({ ok: true });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
