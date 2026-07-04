// ============================================================
// POST /api/celpip/listening/paraphrase
// 错题解析：把听力 transcript + 用户答错的选项交给 LLM，做同义词替换 / 逻辑拆解
// body: { user_id, item_id, wrong_option?: string }
// ============================================================

import { requireUser, json } from "../../../lib/auth.js";
import { loadSettings, volcChatJSON } from "../../../lib/volc.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  const guard = await requireUser(request, env);
  if (!guard.ok) return guard.response;

  try {
    const { item_id, wrong_option } = await request.json();
    if (!item_id) return json({ error: "item_id required" }, 400);
    if (!env.VOLC_API_KEY) return json({ error: "VOLC_API_KEY missing" }, 500);

    const item = await env.DB.prepare(
      "SELECT * FROM celpip_listening_items WHERE id = ?"
    ).bind(item_id).first();
    if (!item) return json({ error: "item not found" }, 404);

    const settings = await loadSettings(env.DB);
    // 复用 listening / generate_dialogue 之外的角色：临时用 inline system prompt
    const systemPrompt = [
      "You are an expert CELPIP Listening coach.",
      "Given the transcript, question, options and user's wrong choice, produce a paraphrase-based explanation.",
      "Return strict JSON with fields:",
      "  paraphrase   : 3-5 sentences rewording the key info that answers the question",
      "  why_wrong    : why the user's chosen option is incorrect (bullet points)",
      "  why_right    : why the correct option is correct",
      "  key_vocab    : array of { word, meaning_zh, example }",
    ].join("\n");

    const userMsg = JSON.stringify({
      transcript: item.transcript,
      question: item.question,
      options: safeParse(item.options),
      correct_answer: item.answer,
      user_wrong_option: wrong_option || null,
    });

    const obj = await volcChatJSON({
      apiKey: env.VOLC_API_KEY,
      endpoint: settings.volc_api_endpoint,
      model: settings.volc_llm_model,
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

function safeParse(s) {
  try { return JSON.parse(s); } catch { return s; }
}
