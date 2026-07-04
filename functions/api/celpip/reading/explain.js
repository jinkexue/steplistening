// ============================================================
// POST /api/celpip/reading/explain
// 阅读求助：给出段落大意 / 定位句（原文摘录）/ 错误选项拆解
// body: { user_id, item_id, question_index?, wrong_option? }
// ============================================================

import { requireUser, json } from "../../../lib/auth.js";
import { loadSettings, volcChatJSON, pickEndpoint, pickModel } from "../../../lib/volc.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  const guard = await requireUser(request, env);
  if (!guard.ok) return guard.response;

  try {
    const { item_id, question_index, wrong_option } = await request.json();
    if (!item_id) return json({ error: "item_id required" }, 400);
    if (!env.VOLC_API_KEY) return json({ error: "VOLC_API_KEY missing" }, 500);

    const item = await env.DB.prepare(
      "SELECT * FROM celpip_reading_items WHERE id = ?"
    ).bind(item_id).first();
    if (!item) return json({ error: "item not found" }, 404);

    const questions = safeParse(item.questions, []);
    const q = Number.isInteger(question_index) ? questions[question_index] : null;

    const settings = await loadSettings(env.DB);
    const systemPrompt = [
      "You are an expert CELPIP Reading coach.",
      "Given a passage and a question, produce a structured helpful explanation in Chinese.",
      "Return strict JSON with fields:",
      "  summary            : 3-5 sentences summarizing the passage",
      "  para_gist          : array of { paragraph_index, gist }",
      "  locator_sentence   : the exact sentence from the passage that answers the question",
      "  why_wrong          : (if user chose a wrong option) explain why it's incorrect",
      "  why_right          : why the correct answer is correct",
      "  key_vocab          : array of { word, meaning_zh, example }",
    ].join("\n");

    const userMsg = JSON.stringify({
      passage: item.passage,
      title: item.title,
      question: q ? q.q || q.question : null,
      options: q ? q.options : null,
      correct_answer: q ? q.answer : null,
      user_wrong_option: wrong_option || null,
    });

    const obj = await volcChatJSON({
      apiKey: env.VOLC_API_KEY,
      endpoint: pickEndpoint(settings, "llm"),
      model: pickModel(settings, "llm"),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMsg },
      ],
    });

    return json({ result: obj });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

function safeParse(s, fb) { try { return JSON.parse(s); } catch { return fb; } }
