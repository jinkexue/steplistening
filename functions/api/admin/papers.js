// ============================================================
// 管理员：试卷内单条题目 CRUD
// GET  /api/admin/papers?user_id=&paper_id=<id>  -> 试卷详细（4 section + 全部 items）
// POST /api/admin/papers
//   body: { action:'add_item'|'update_item'|'delete_item',
//           section:'listening'|'reading'|'writing'|'speaking',
//           item: {...} }
// ============================================================

import { requireAdmin, json } from "../../lib/auth.js";

const TABLE = {
  listening: "celpip_listening_items",
  reading: "celpip_reading_items",
  writing: "celpip_writing_items",
  speaking: "celpip_speaking_items",
};

export async function onRequestGet(context) {
  const { request, env } = context;
  const guard = await requireAdmin(request, env);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const paperId = url.searchParams.get("paper_id");
  if (!paperId) {
    // 列表
    const rows = await env.DB.prepare(
      "SELECT * FROM celpip_papers ORDER BY created_at DESC"
    ).all();
    return json({ papers: rows.results });
  }
  try {
    const paper = await env.DB.prepare("SELECT * FROM celpip_papers WHERE id = ?").bind(paperId).first();
    if (!paper) return json({ error: "paper not found" }, 404);
    const sections = await env.DB.prepare(
      "SELECT * FROM celpip_paper_sections WHERE paper_id = ?"
    ).bind(paperId).all();

    const items = {};
    for (const s of sections.results || []) {
      const table = TABLE[s.section];
      if (!table) continue;
      const r = await env.DB.prepare(
        `SELECT * FROM ${table} WHERE section_id = ? ORDER BY order_index, id`
      ).bind(s.id).all();
      items[s.section] = { section_id: s.id, list: r.results };
    }
    return json({ paper, items });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const guard = await requireAdmin(request, env);
  if (!guard.ok) return guard.response;

  try {
    const data = await request.json();
    const { action, section, item } = data;
    if (!section || !TABLE[section]) return json({ error: "section invalid" }, 400);
    const table = TABLE[section];

    if (action === "add_item") {
      if (!item?.section_id) return json({ error: "item.section_id required" }, 400);
      const cols = Object.keys(item);
      const placeholders = cols.map(() => "?").join(", ");
      const values = cols.map(k => item[k]);
      const r = await env.DB.prepare(
        `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`
      ).bind(...values).run();
      return json({ id: r.meta.last_row_id }, 201);
    }

    if (action === "update_item") {
      if (!item?.id) return json({ error: "item.id required" }, 400);
      const { id, ...rest } = item;
      const cols = Object.keys(rest);
      if (cols.length === 0) return json({ ok: true });
      const setStmt = cols.map(c => `${c} = ?`).join(", ");
      const values = [...cols.map(k => rest[k]), id];
      await env.DB.prepare(`UPDATE ${table} SET ${setStmt} WHERE id = ?`).bind(...values).run();
      return json({ ok: true });
    }

    if (action === "delete_item") {
      if (!item?.id) return json({ error: "item.id required" }, 400);
      await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(item.id).run();
      return json({ ok: true });
    }

    return json({ error: "invalid action" }, 400);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
