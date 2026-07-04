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
 * - 优先尝试 OpenAI 兼容的 response_format: json_object
 * - 若模型不支持（如 ark-code-latest 会 400 "not supported by this model"），
 *   自动去掉 response_format 重试；并靠强化 system prompt + 正则兜底提取
 */
export async function volcChatJSON(opts) {
  // 拷贝 messages 并追加 JSON 硬约束（不改动调用方原 messages）
  const enforcedMessages = (opts.messages || []).map((m, i) => {
    if (i === 0 && m.role === "system") {
      return {
        ...m,
        content: (m.content || "") +
          "\n\nIMPORTANT: You MUST respond with ONLY a valid JSON object. " +
          "Do NOT include markdown code fences (```json etc), explanations, or any text outside the JSON. " +
          "Start with { and end with }.",
      };
    }
    return m;
  });
  // 若第一条不是 system，则在最前面补一条
  if (!enforcedMessages[0] || enforcedMessages[0].role !== "system") {
    enforcedMessages.unshift({
      role: "system",
      content: "You MUST respond with ONLY a valid JSON object. No markdown, no code fences, no extra text.",
    });
  }

  const baseOpts = { ...opts, messages: enforcedMessages };

  let text = "";
  try {
    text = await volcChatText({
      ...baseOpts,
      response_format: { type: "json_object" },
    });
  } catch (e) {
    // 模型不支持 response_format 时，自动去掉参数重试
    if (/response_format/i.test(e.message) || /not supported/i.test(e.message)) {
      text = await volcChatText(baseOpts);
    } else {
      throw e;
    }
  }

  // 清洗常见污染
  const cleaned = text
    .replace(/^\uFEFF/, "")
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch (e2) {
        throw new Error(`volc JSON parse failed after cleanup: ${e2.message} :: ${cleaned.slice(0, 300)}`);
      }
    }
    throw new Error(`volc JSON parse failed (no braces): ${cleaned.slice(0, 300)}`);
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
 * 火山方舟文生图（doubao-seedream 系列，走 /api/plan/v3/images/generations）
 * 关键差异：size 使用 "1K/2K/4K" 字符串（不是 1024x1024）；
 *          必须带 watermark:false；output_format 建议 jpeg。
 * 返回 { url?: string, b64_json?: string }
 */
export async function volcImage({
  apiKey,
  endpoint,
  model,
  prompt,
  size = "2K",
  outputFormat = "jpeg",
  watermark = false,
  n,
  extraBody,
}) {
  if (!apiKey) throw new Error("VOLC_API_KEY missing");
  if (!model) throw new Error("image model missing");
  if (!prompt) throw new Error("image prompt missing");
  // 若 endpoint 已经包含 /images/generations，则直接使用；否则拼接
  const url = /\/images\/generations\/?$/.test((endpoint || "").trim())
    ? (endpoint || "").replace(/\/+$/, "")
    : joinUrl(endpoint, "/images/generations");

  // 组装 body：seedream 系列要求 size 为 "1K"/"2K"/"4K"，加上 watermark 与 output_format
  const body = {
    model,
    prompt,
    size,
    output_format: outputFormat,
    watermark,
    ...(extraBody || {}),
  };
  if (n && n !== 1) body.n = n;

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
    throw new Error(`volc image failed: ${resp.status} ${text} | url=${url} body=${JSON.stringify(body).slice(0, 200)}`);
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
    endpoint: pickEndpoint(settings, "llm"),
    model: pickModel(settings, "llm"),
    messages,
    response_format,
  });
}

/**
 * 按用途读取 endpoint / model
 * kind: 'llm' | 'vision' | 'image' | 'volc_tts' | 'volc_stt'
 * 优先读取新字段（llm_endpoint / vision_endpoint / image_endpoint …），
 * 未设置时回退到 volc_api_endpoint（旧兼容）
 * 特例：vision 若 settings.vision_same_as_llm 为 '1'/'true' 或 vision_model 为空，则复用 llm_ 字段
 */
export function pickEndpoint(settings, kind) {
  if (kind === "vision" && isVisionFallback(settings)) {
    return (settings?.llm_endpoint || settings?.volc_api_endpoint || "").trim();
  }
  const key = {
    llm: "llm_endpoint",
    vision: "vision_endpoint",
    image: "image_endpoint",
    volc_tts: "volc_tts_endpoint",
    volc_stt: "volc_stt_endpoint",
  }[kind];
  return (settings?.[key] || settings?.volc_api_endpoint || "").trim();
}
export function pickModel(settings, kind) {
  if (kind === "vision" && isVisionFallback(settings)) {
    return (settings?.llm_model || "").trim();
  }
  const key = {
    llm: "llm_model",
    vision: "vision_model",
    image: "image_model",
    volc_tts: "volc_tts_model",
    volc_stt: "volc_stt_model",
    cf_tts: "cf_tts_model",
    cf_stt: "cf_stt_model",
  }[kind];
  return (settings?.[key] || "").trim();
}

/**
 * 判断 vision 是否需要 fallback 到 llm：
 *   1) 管理员显式勾选 vision_same_as_llm
 *   2) 或者 vision_model 未配置（防止空 model 报错）
 */
function isVisionFallback(settings) {
  const flag = String(settings?.vision_same_as_llm || "").toLowerCase();
  if (flag === "1" || flag === "true" || flag === "yes") return true;
  return !((settings?.vision_model || "").trim());
}
