// ============================================================
// POST /api/celpip/writing/score
// 官方 CELPIP Examiner 四维评分：Content/Coherence, Vocabulary, Readability, Task Fulfillment
// 同时返回一版 CLB 9+ 范文重写
// body: { user_id, item_id, essay }
// ============================================================

import { requireUser, json } from "../../../lib/auth.js";
import { loadSettings, volcChatJSON, pickEndpoint, pickModel } from "../../../lib/volc.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  const guard = await requireUser(request, env);
  if (!guard.ok) return guard.response;

  try {
    const { item_id, essay, paper_id } = await request.json();
    if (!item_id) return json({ error: "item_id required" }, 400);
    if (!essay || essay.trim().length < 20) return json({ error: "essay too short" }, 400);
    if (!env.VOLC_API_KEY) return json({ error: "VOLC_API_KEY missing" }, 500);

    const item = await env.DB.prepare(
      "SELECT * FROM celpip_writing_items WHERE id = ?"
    ).bind(item_id).first();
    if (!item) return json({ error: "item not found" }, 404);

    const settings = await loadSettings(env.DB);
    // 优先读用户可编辑的评分 prompt（scoring / writing_score），无则用兜底
    const promptRow = await env.DB.prepare(
      "SELECT system_prompt FROM celpip_prompts WHERE section='scoring' AND name='writing_score' AND active=1 ORDER BY version DESC LIMIT 1"
    ).first();
    const systemPrompt = promptRow?.system_prompt || [
      "You are an official CELPIP Writing examiner.",
      "Score the essay strictly across four dimensions (each 3-12 on CLB scale):",
      "  content_coherence, vocabulary, readability, task_fulfillment.",
      "Output strict JSON: {content_coherence, vocabulary, readability, task_fulfillment,",
      "  overall_clb, feedback:{strengths:[], weaknesses:[], suggestions:[]},",
      "  rewritten_sample:'CLB 9+ 级别的重写范文（保持字数与题目要求相符）'}",
    ].join("\n");

    const wordCount = essay.trim().split(/\s+/).length;
    const userMsg = JSON.stringify({
      task: item.task,
      prompt: item.prompt,
      background: item.background,
      chart_data: safeParse(item.chart_data),
      min_words: item.min_words,
      max_words: item.max_words,
      word_count: wordCount,
      essay,
    });

    const obj = await volcChatJSON({
      apiKey: env.VOLC_API_KEY,
      endpoint: pickEndpoint(settings, "llm"),
      model: pickModel(settings, "llm"),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMsg },
      ],
      max_tokens: 3000,
    });

    // 记录到 attempts（如果传了 paper_id）
    if (paper_id) {
      await env.DB.prepare(
        `INSERT INTO celpip_attempts
          (paper_id, user_id, section, item_id, essay, score_json, status, updated_at)
         VALUES (?, ?, 'writing', ?, ?, ?, 'graded', CURRENT_TIMESTAMP)
         ON CONFLICT(paper_id, user_id, section, item_id)
         DO UPDATE SET
           essay = excluded.essay,
           score_json = excluded.score_json,
           status = 'graded',
           updated_at = CURRENT_TIMESTAMP`
      ).bind(paper_id, guard.user.id, item_id, essay, JSON.stringify(obj)).run();
    }

    return json({ result: obj, word_count: wordCount });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
