// ============================================================
// 火山方舟 (Volcengine Ark) LLM / Vision / 文生图 封装
// 采用 OpenAI 兼容接口：chat/completions, images/generations
// 配置来源：
//   - env.VOLC_API_KEY   （wrangler secret put VOLC_API_KEY）
//   - app_settings 表    （endpoint / 各 model 名称，管理员可改）
// ============================================================

/**
 * 读取 app_settings 表内所有配置为对象
 * @param {D1Database} DB
 * @returns {Promise<Record<string,string>>}
 */
export async function loadSettings(DB) {
  const res = await DB.prepare("SELECT key, value FROM app_settings").all();
  const map = {};
  for (const row of res.results || []) {
    map[row.key] = row.value || "";
  }
  return map;
}

/**
 * 更新单条设置
 */
export async function setSetting(DB, key, value) {
  await DB.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP"
  ).bind(key, value ?? "").run();
}

/**
 * 组合完整 URL：endpoint + path
 */
function joinUrl(endpoint, path) {
  const base = (endpoint || "").replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

/**
 * 火山方舟 chat/completions（OpenAI 兼容）
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.endpoint  例如 https://ark.cn-beijing.volces.com/api/v3
 * @param {string} opts.model     模型 ID/引用名
 * @param {Array}  opts.messages  [{role, content}]
 * @param {object} [opts.response_format]  {type:'json_object'}
 * @param {number} [opts.temperature]
 * @param {number} [opts.max_tokens]
 * @returns {Promise<any>} 原始 OpenAI 响应
 */
export async function volcChat({
  apiKey,
  endpoint,
  model,
  messages,
  response_format,
  temperature = 0.7,
  max_tokens = 2048,
}) {
  if (!apiKey) throw new Error("VOLC_API_KEY missing");
  if (!endpoint) throw new Error("volc endpoint missing");
  if (!model) throw new Error("volc model missing");

  const url = joinUrl(endpoint, "/chat/completions");
  const body = {
    model,
    messages,
    temperature,
    max_tokens,
  };
  if (response_format) body.response_format = response_format;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`volc chat failed: ${resp.status} ${text}`);
  }
  return await resp.json();
}

/**
 * 便捷方法：只取 assistant 的文本
 */
export async function volcChatText(opts) {
  const data = await volcChat(opts);
  return data?.choices?.[0]?.message?.content ?? "";
}

/**
 * 便捷方法：让模型返回严格 JSON 对象
 */
export async function volcChatJSON(opts) {
  const merged = {
    ...opts,
    response_format: { type: "json_object" },
  };
  const text = await volcChatText(merged);
  try {
    return JSON.parse(text);
  } catch (e) {
    // 兜底：截取 { ... }
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error(`volc JSON parse failed: ${text.slice(0, 200)}`);
  }
}

/**
 * 火山方舟视觉能力：把图片 URL 作为多模态输入
 * @param {object} opts
 * @param {string} opts.imageUrl
 * @param {string} opts.userPrompt
 * @param {string} opts.systemPrompt
 */
export async function volcVision({
  apiKey,
  endpoint,
  model,
  imageUrl,
  userPrompt,
  systemPrompt,
}) {
  const messages = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({
    role: "user",
    content: [
      { type: "text", text: userPrompt || "Describe this image." },
      { type: "image_url", image_url: { url: imageUrl } },
    ],
  });
  return await volcChat({ apiKey, endpoint, model, messages });
}

/**
 * 火山方舟文生图（OpenAI 兼容 images/generations）
 * 返回 { url?: string, b64_json?: string }
 */
export async function volcImage({
  apiKey,
  endpoint,
  model,
  prompt,
  size = "1024x1024",
  n = 1,
}) {
  if (!apiKey) throw new Error("VOLC_API_KEY missing");
  const url = joinUrl(endpoint, "/images/generations");
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, prompt, size, n }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`volc image failed: ${resp.status} ${text}`);
  }
  const data = await resp.json();
  const item = data?.data?.[0];
  if (!item) throw new Error("volc image empty response");
  return item; // { url, b64_json } 之一
}

/**
 * 便捷组装：读取 settings + 从 celpip_prompts 拿系统提示词 + 调用 chat
 */
export async function volcChatWithPrompt(DB, env, {
  section, name, userContent, response_format,
}) {
  const settings = await loadSettings(DB);
  const promptRow = await DB.prepare(
    "SELECT system_prompt FROM celpip_prompts WHERE section = ? AND name = ? AND active = 1 ORDER BY version DESC LIMIT 1"
  ).bind(section, name).first();
  const systemPrompt = promptRow?.system_prompt || "";
  const messages = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: userContent });
  return await volcChat({
    apiKey: env.VOLC_API_KEY,
    endpoint: settings.volc_api_endpoint,
    model: settings.volc_llm_model,
    messages,
    response_format,
  });
}
