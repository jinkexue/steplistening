// ============================================================
// GET  /api/celpip/papers                -> 已发布试卷列表（含当前用户进度）
// POST /api/celpip/papers                -> action:'create'|'update'|'delete'|'publish'（管理员）
// GET  /api/celpip/papers?id=<paperId>   -> 单份试卷详情（含四板块 item 概览）
// ============================================================

import { requireAdmin, requireUser, json } from "../../lib/auth.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const userId = url.searchParams.get("user_id");

  try {
    if (id) {
      const paper = await env.DB.prepare(
        "SELECT * FROM celpip_papers WHERE id = ?"
      ).bind(id).first();
      if (!paper) return json({ error: "paper not found" }, 404);

      // 载入四板块及各 section 下的题目数量
      const sections = await env.DB.prepare(
        "SELECT * FROM celpip_paper_sections WHERE paper_id = ?"
      ).bind(id).all();

      const counts = {};
      for (const s of sections.results || []) {
        const tableMap = {
          listening: "celpip_listening_items",
          reading: "celpip_reading_items",
          writing: "celpip_writing_items",
          speaking: "celpip_speaking_items",
        };
        const table = tableMap[s.section];
        if (!table) continue;
        const c = await env.DB.prepare(
          `SELECT COUNT(*) AS n FROM ${table} WHERE section_id = ?`
        ).bind(s.id).first();
        counts[s.section] = c?.n || 0;
      }

      return json({ paper, sections: sections.results, counts });
    }

    // 列表：可选筛选 status
    const status = url.searchParams.get("status") || "published";
    const rows = await env.DB.prepare(
      "SELECT id, title, difficulty, status, created_at FROM celpip_papers WHERE status = ? ORDER BY created_at DESC"
    ).bind(status).all();

    // 附带进度（若传了 user_id）
    let progress = {};
    if (userId) {
      const attempts = await env.DB.prepare(
        `SELECT paper_id, COUNT(*) AS answered
         FROM celpip_attempts WHERE user_id = ? GROUP BY paper_id`
      ).bind(userId).all();
      for (const r of attempts.results || []) {
        progress[r.paper_id] = { answered: r.answered };
      }
    }

    return json({ papers: rows.results, progress });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  // 写操作要求 admin
  const guard = await requireAdmin(request, env);
  if (!guard.ok) return guard.response;

  try {
    const data = await request.json();
    const { action, id, title, difficulty, status } = data;

    if (action === "create") {
      if (!title) return json({ error: "title required" }, 400);
      const r = await env.DB.prepare(
        "INSERT INTO celpip_papers (title, difficulty, status, created_by) VALUES (?, ?, ?, ?)"
      ).bind(title, difficulty || "CLB9", status || "draft", guard.user.id).run();
      const paperId = r.meta.last_row_id;
      // 自动创建 4 个 section + 骨架题目占位
      const sectionIds = {};
      for (const s of ["listening", "reading", "writing", "speaking"]) {
        const sr = await env.DB.prepare(
          "INSERT INTO celpip_paper_sections (paper_id, section) VALUES (?, ?)"
        ).bind(paperId, s).run();
        sectionIds[s] = sr.meta.last_row_id;
      }
      // 听力 Part 1-6 骨架（一条记录=一个 Part）
      const listenLayouts = {
        1: { layout: "segmented",          timer: null },
        2: { layout: "segmented",          timer: null },
        3: { layout: "shared_timer",       timer: 240 },
        4: { layout: "shared_timer",       timer: 180 },
        5: { layout: "multi_image_shared", timer: 300 },
        6: { layout: "shared_timer",       timer: 240 },
      };
      for (const p of [1, 2, 3, 4, 5, 6]) {
        const meta = listenLayouts[p];
        await env.DB.prepare(
          `INSERT INTO celpip_listening_items
            (section_id, part, order_index, title, part_layout, shared_timer_seconds,
             transcript, question, options, answer, segments_json, questions_json, image_prompts_json)
           VALUES (?, ?, ?, '', ?, ?, '', '', '[]', '', '[]', '[]', '[]')`
        ).bind(sectionIds.listening, p, p, meta.layout, meta.timer).run();
      }
      // 阅读 4 个 Part
      for (const p of [1, 2, 3, 4]) {
        await env.DB.prepare(
          `INSERT INTO celpip_reading_items (section_id, part, order_index, title, passage, questions)
           VALUES (?, ?, ?, '', '', '[]')`
        ).bind(sectionIds.reading, p, p).run();
      }
      // 写作 2 个 Task
      for (const t of [1, 2]) {
        await env.DB.prepare(
          `INSERT INTO celpip_writing_items (section_id, task, order_index, prompt, background, chart_data, min_words, max_words)
           VALUES (?, ?, ?, '', '', NULL, 150, 200)`
        ).bind(sectionIds.writing, t, t).run();
      }
      // 口语 4 个 Task（简化：只做 Task 1-4，避免 8 张图消耗）
      for (const t of [1, 2, 3, 4]) {
        await env.DB.prepare(
          `INSERT INTO celpip_speaking_items (section_id, task, order_index, prompt, image_prompt, vision_hints, prep_seconds, record_seconds)
           VALUES (?, ?, ?, '', NULL, NULL, 30, 60)`
        ).bind(sectionIds.speaking, t, t).run();
      }
      return json({ id: paperId, seeded: true }, 201);
    }

    if (action === "update") {
      if (!id) return json({ error: "id required" }, 400);
      await env.DB.prepare(
        "UPDATE celpip_papers SET title = COALESCE(?, title), difficulty = COALESCE(?, difficulty), status = COALESCE(?, status), updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).bind(title || null, difficulty || null, status || null, id).run();
      return json({ ok: true });
    }

    if (action === "publish") {
      if (!id) return json({ error: "id required" }, 400);
      await env.DB.prepare("UPDATE celpip_papers SET status = 'published', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }

    if (action === "delete") {
      if (!id) return json({ error: "id required" }, 400);
      await env.DB.prepare("DELETE FROM celpip_papers WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }

    return json({ error: "invalid action" }, 400);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
