// ============================================================
// 管理员：CELPIP 提示词模板 CRUD
// GET  /api/admin/prompts?user_id=&section=
// POST /api/admin/prompts  body: {action, id?, section?, name?, system_prompt?, version?, active?}
// ============================================================

import { requireAdmin, json } from "../../lib/auth.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const guard = await requireAdmin(request, env);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const section = url.searchParams.get("section");
  try {
    let rows;
    if (section) {
      rows = await env.DB.prepare(
        "SELECT * FROM celpip_prompts WHERE section = ? ORDER BY id DESC"
      ).bind(section).all();
    } else {
      rows = await env.DB.prepare(
        "SELECT * FROM celpip_prompts ORDER BY section, id DESC"
      ).all();
    }
    return json({ prompts: rows.results });
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
    const { action, id, section, name, system_prompt, version, active } = data;

    if (action === "create") {
      if (!section || !name || !system_prompt) return json({ error: "section/name/system_prompt required" }, 400);
      const r = await env.DB.prepare(
        "INSERT INTO celpip_prompts (section, name, system_prompt, version, active) VALUES (?, ?, ?, ?, ?)"
      ).bind(section, name, system_prompt, version || 1, active ?? 1).run();
      return json({ id: r.meta.last_row_id }, 201);
    }

    if (action === "update") {
      if (!id) return json({ error: "id required" }, 400);
      await env.DB.prepare(
        "UPDATE celpip_prompts SET " +
        "  system_prompt = COALESCE(?, system_prompt), " +
        "  version = COALESCE(?, version), " +
        "  active = COALESCE(?, active), " +
        "  updated_at = CURRENT_TIMESTAMP " +
        "WHERE id = ?"
      ).bind(system_prompt ?? null, version ?? null, active ?? null, id).run();
      return json({ ok: true });
    }

    if (action === "delete") {
      if (!id) return json({ error: "id required" }, 400);
      await env.DB.prepare("DELETE FROM celpip_prompts WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }

    return json({ error: "invalid action" }, 400);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
