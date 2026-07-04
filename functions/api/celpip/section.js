// ============================================================
// GET /api/celpip/section?paper_id=<id>&section=<listening|reading|writing|speaking>
// 返回该试卷指定板块下的全部题目（供答题页/导航使用）
// 若同时提供 user_id，会附带该用户在此板块的进度快照
// ============================================================

import { requireUser, json } from "../../lib/auth.js";

const TABLE = {
  listening: "celpip_listening_items",
  reading: "celpip_reading_items",
  writing: "celpip_writing_items",
  speaking: "celpip_speaking_items",
};

export async function onRequestGet(context) {
  const { request, env } = context;
  const guard = await requireUser(request, env);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const paperId = url.searchParams.get("paper_id");
  const section = url.searchParams.get("section");
  if (!paperId || !section) return json({ error: "paper_id / section required" }, 400);
  const table = TABLE[section];
  if (!table) return json({ error: "invalid section" }, 400);

  try {
    // 找到 section id
    const sec = await env.DB.prepare(
      "SELECT id FROM celpip_paper_sections WHERE paper_id = ? AND section = ?"
    ).bind(paperId, section).first();
    if (!sec) return json({ items: [], attempts: [] });

    const items = await env.DB.prepare(
      `SELECT * FROM ${table} WHERE section_id = ? ORDER BY order_index, id`
    ).bind(sec.id).all();

    const attempts = await env.DB.prepare(
      "SELECT * FROM celpip_attempts WHERE user_id = ? AND paper_id = ? AND section = ?"
    ).bind(guard.user.id, paperId, section).all();

    return json({
      section_id: sec.id,
      items: items.results || [],
      attempts: attempts.results || [],
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
