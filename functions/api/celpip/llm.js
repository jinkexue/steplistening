// ============================================================
// POST /api/celpip/llm
// 统一 LLM 网关：根据 intent 决定使用哪个 system prompt，转发到火山方舟
// body: { intent, payload, user_id }
// 支持的 intent:
//   generate_listening  / generate_reading / generate_writing / generate_speaking
//   score_writing / score_speaking / paraphrase / reading_explain / agent_plan
// ============================================================

import { requireUser, json } from "../../lib/auth.js";
import { loadSettings, volcChat, volcChatJSON } from "../../lib/volc.js";

const INTENT_PROMPT_MAP = {
  generate_listening: { section: "listening", name: "generate_dialogue", jsonOnly: true },
  generate_reading:   { section: "reading",   name: "generate_passage", jsonOnly: true },
  generate_writing:   { section: "writing",   name: "generate_prompt",  jsonOnly: true },
  generate_speaking:  { section: "speaking",  name: "generate_task",    jsonOnly: true },
  score_writing:      { section: "scoring",   name: "writing_score",    jsonOnly: true },
  score_speaking:     { section: "scoring",   name: "speaking_feedback",jsonOnly: true },
  paraphrase:         { section: "listening", name: "generate_dialogue",jsonOnly: false },
  reading_explain:    { section: "reading",   name: "generate_passage", jsonOnly: false },
  agent_plan:         { section: "scoring",   name: "writing_score",    jsonOnly: false },
};

export async function onRequestPost(context) {
  const { request, env } = context;
  const guard = await requireUser(request, env);
  if (!guard.ok) return guard.response;

  try {
    const { intent, payload } = await request.json();
    const map = INTENT_PROMPT_MAP[intent];
    if (!map) return json({ error: "unknown intent" }, 400);

    const settings = await loadSettings(env.DB);
    if (!env.VOLC_API_KEY) return json({ error: "VOLC_API_KEY not set" }, 500);

    // 取 system prompt
    const prow = await env.DB.prepare(
      "SELECT system_prompt FROM celpip_prompts WHERE section = ? AND name = ? AND active = 1 ORDER BY version DESC LIMIT 1"
    ).bind(map.section, map.name).first();
    const systemPrompt = prow?.system_prompt || "";

    const messages = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({
      role: "user",
      content: typeof payload === "string" ? payload : JSON.stringify(payload || {}),
    });

    const opts = {
      apiKey: env.VOLC_API_KEY,
      endpoint: settings.volc_api_endpoint,
      model: settings.volc_llm_model,
      messages,
    };

    if (map.jsonOnly) {
      const obj = await volcChatJSON(opts);
      return json({ intent, result: obj });
    } else {
      const data = await volcChat(opts);
      return json({ intent, result: data?.choices?.[0]?.message?.content ?? "" });
    }
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
