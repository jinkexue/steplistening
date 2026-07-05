// ============================================================
// POST /api/admin/generate_one
// 单题生成接口 - 每次只处理一道题，返回详细的错误信息以便调试
// body: {
//   user_id, paper_id, section, part_or_task,
//   with_asset?: boolean  // listening 是否顺带 TTS；speaking 是否顺带生图
// }
// 返回：{ ok, item?, error?, stage?, endpoint?, model?, raw_llm? }
// ============================================================

import { requireAdmin, json } from "../../lib/auth.js";
import { loadSettings, volcChatJSON, pickEndpoint, pickModel, volcImage } from "../../lib/volc.js";

const SECTIONS = ["listening", "reading", "writing", "speaking"];

async function sha256Hex(text) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function ensureSection(env, paperId, section) {
  const row = await env.DB.prepare(
    "SELECT id FROM celpip_paper_sections WHERE paper_id = ? AND section = ?"
  ).bind(paperId, section).first();
  if (row) return row.id;
  const r = await env.DB.prepare(
    "INSERT INTO celpip_paper_sections (paper_id, section) VALUES (?, ?)"
  ).bind(paperId, section).run();
  return r.meta.last_row_id;
}

async function getSystemPrompt(env, section, name) {
  const r = await env.DB.prepare(
    "SELECT system_prompt FROM celpip_prompts WHERE section = ? AND name = ? AND active = 1 ORDER BY version DESC LIMIT 1"
  ).bind(section, name).first();
  return r?.system_prompt || "";
}

async function tts(env, settings, text) {
  const provider = (settings.tts_provider || "cloudflare").toLowerCase();
  if (provider === "volc") {
    const model = pickModel(settings, "volc_tts");
    const endpoint = pickEndpoint(settings, "volc_tts");
    if (!model) throw new Error("volc_tts_model not configured");
    const hash = await sha256Hex(`volc|${model}|${text}`);
    const r2Key = `celpip/tts/${hash}.mp3`;
    if (await env.BUCKET.head(r2Key)) return r2Key;
    const base = endpoint.replace(/\/+$/, "");
    const resp = await fetch(`${base}/audio/speech`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.VOLC_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: text, voice: "alloy", response_format: "mp3" }),
    });
    if (!resp.ok) throw new Error(`volc TTS ${resp.status}: ${await resp.text()}`);
    const bytes = new Uint8Array(await resp.arrayBuffer());
    await env.BUCKET.put(r2Key, bytes, { httpMetadata: { contentType: "audio/mpeg" } });
    return r2Key;
  }
  const model = pickModel(settings, "cf_tts") || "@cf/deepgram/aura-2-en";
  const hash = await sha256Hex(`cf|${model}|${text}`);
  const r2Key = `celpip/tts/${hash}.mp3`;
  if (await env.BUCKET.head(r2Key)) return r2Key;
  const res = await env.AI.run(model, { text });
  let bytes;
  if (res instanceof ReadableStream) {
    const reader = res.getReader(); const chunks = [];
    while (true) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); }
    bytes = new Blob(chunks);
  } else if (res?.audio) {
    const bin = atob(res.audio); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); bytes = arr;
  } else if (res instanceof ArrayBuffer || res instanceof Uint8Array) bytes = res;
  else throw new Error("Unknown TTS response");
  await env.BUCKET.put(r2Key, bytes, { httpMetadata: { contentType: "audio/mpeg" } });
  return r2Key;
}

async function genImage(env, settings, prompt) {
  const model = pickModel(settings, "image");
  const endpoint = pickEndpoint(settings, "image");
  if (!model) throw new Error("image_model not configured");
  const item = await volcImage({
    apiKey: env.VOLC_API_KEY, endpoint, model, prompt, size: "2K",
  });
  let bytes;
  if (item.url) {
    const r = await fetch(item.url);
    if (!r.ok) throw new Error(`fetch image url ${r.status}`);
    bytes = new Uint8Array(await r.arrayBuffer());
  } else if (item.b64_json) {
    const bin = atob(item.b64_json); bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } else throw new Error("image response empty");
  const hash = await sha256Hex(prompt + Date.now());
  const key = `celpip/speaking/${hash}.jpg`;
  await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: "image/jpeg" } });
  return key;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const guard = await requireAdmin(request, env);
  if (!guard.ok) return guard.response;

  const trace = { stage: "start" };
  try {
    const body = await request.json();
    const { paper_id, section, part_or_task, with_asset = true } = body;
    if (!paper_id || !section) return json({ ok: false, stage: "validate", error: "paper_id / section required" }, 400);
    if (!SECTIONS.includes(section)) return json({ ok: false, stage: "validate", error: "invalid section" }, 400);
    if (!env.VOLC_API_KEY) return json({ ok: false, stage: "check_key", error: "VOLC_API_KEY not set in Cloudflare env" }, 500);

    trace.section = section;
    trace.part_or_task = part_or_task;

    // 预检 settings
    trace.stage = "load_settings";
    const settings = await loadSettings(env.DB);
    const endpoint = pickEndpoint(settings, "llm");
    const model = pickModel(settings, "llm");
    trace.endpoint = endpoint;
    trace.model = model;
    if (!endpoint) return json({ ok: false, ...trace, error: "llm_endpoint not configured, please set in AI 配置" }, 400);
    if (!model)    return json({ ok: false, ...trace, error: "llm_model not configured, please set in AI 配置" }, 400);

    // section id
    trace.stage = "ensure_section";
    const sectionId = await ensureSection(env, paper_id, section);
    trace.section_id = sectionId;

    // system prompt
    trace.stage = "load_prompt";
    const promptNames = {
      listening: "generate_dialogue", reading: "generate_passage",
      writing: "generate_prompt",     speaking: "generate_task",
    };
    const systemPrompt = await getSystemPrompt(env, section, promptNames[section]);
    if (!systemPrompt) return json({ ok: false, ...trace, error: `system prompt (${section}/${promptNames[section]}) missing, please run 初始化数据库` }, 500);

    // 组装 user prompt
    let userAsk;
    if (section === "listening") {
      userAsk = JSON.stringify({
        part: part_or_task, note: "Generate ONE authentic CELPIP Listening item. Return strict JSON: {transcript, question, options:[...], answer}. Keep transcript 40-120 words.",
      });
    } else if (section === "reading") {
      userAsk = JSON.stringify({
        part: part_or_task, note: "Generate ONE CELPIP Reading passage + 4-6 drop-down questions. Return strict JSON: {title, passage, questions:[{q, options:[...], answer}]}. Keep 200-500 words.",
      });
    } else if (section === "writing") {
      const t = part_or_task;
      userAsk = JSON.stringify({
        task: t,
        note: t === 1
          ? "Generate CELPIP Writing Task 1 (email). Return strict JSON: {prompt, background, min_words:150, max_words:200}."
          : "Generate CELPIP Writing Task 2 (survey response) with chart_data as {question, options:[{label, percent}]}. Return strict JSON: {prompt, background, chart_data, min_words:150, max_words:200}.",
      });
    } else {
      userAsk = JSON.stringify({
        task: part_or_task,
        note: "Generate CELPIP Speaking task. For Task 3/4 include image_prompt for a text-to-image model, and vision_hints (structured description). Return strict JSON: {prompt, image_prompt?, vision_hints?, prep_seconds, record_seconds}.",
      });
    }

    // 调用 LLM
    trace.stage = "llm_call";
    let obj;
    try {
      obj = await volcChatJSON({
        apiKey: env.VOLC_API_KEY,
        endpoint, model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userAsk },
        ],
        max_tokens: 3500,
      });
    } catch (e) {
      return json({ ok: false, ...trace, error: `LLM 调用失败：${e.message}` }, 500);
    }
    trace.llm_ok = true;

    // 落库
    trace.stage = "db_insert";
    let itemId;
    if (section === "listening") {
      const r = await env.DB.prepare(
        `INSERT INTO celpip_listening_items (section_id, part, transcript, question, options, answer, order_index)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(sectionId, part_or_task, obj.transcript || "", obj.question || "",
              JSON.stringify(obj.options || []), String(obj.answer ?? ""), part_or_task).run();
      itemId = r.meta.last_row_id;
    } else if (section === "reading") {
      const r = await env.DB.prepare(
        `INSERT INTO celpip_reading_items (section_id, part, title, passage, questions, order_index)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(sectionId, part_or_task, obj.title || "", obj.passage || "",
              JSON.stringify(obj.questions || []), part_or_task).run();
      itemId = r.meta.last_row_id;
    } else if (section === "writing") {
      const r = await env.DB.prepare(
        `INSERT INTO celpip_writing_items (section_id, task, prompt, background, chart_data, min_words, max_words, order_index)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(sectionId, part_or_task, obj.prompt || "", obj.background || "",
              JSON.stringify(obj.chart_data || null),
              obj.min_words || 150, obj.max_words || 200, part_or_task).run();
      itemId = r.meta.last_row_id;
    } else {
      const r = await env.DB.prepare(
        `INSERT INTO celpip_speaking_items (section_id, task, prompt, image_prompt, vision_hints, prep_seconds, record_seconds, order_index)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(sectionId, part_or_task, obj.prompt || "", obj.image_prompt || null,
              JSON.stringify(obj.vision_hints || null),
              obj.prep_seconds || 30, obj.record_seconds || 60, part_or_task).run();
      itemId = r.meta.last_row_id;
    }
    trace.item_id = itemId;

    // 附加资源生成（不影响主流程；失败仅记录）
    const assetResults = {};
    if (with_asset && section === "listening" && obj.transcript) {
      trace.stage = "listening_tts";
      try {
        const key = await tts(env, settings, obj.transcript);
        await env.DB.prepare("UPDATE celpip_listening_items SET audio_key = ? WHERE id = ?").bind(key, itemId).run();
        assetResults.audio_key = key;
      } catch (e) {
        assetResults.tts_error = e.message;
      }
    }
    if (with_asset && section === "speaking" && obj.image_prompt && (part_or_task === 3 || part_or_task === 4)) {
      trace.stage = "speaking_image";
      try {
        const key = await genImage(env, settings, obj.image_prompt);
        await env.DB.prepare("UPDATE celpip_speaking_items SET image_key = ? WHERE id = ?").bind(key, itemId).run();
        assetResults.image_key = key;
      } catch (e) {
        assetResults.image_error = e.message;
      }
    }

    return json({ ok: true, ...trace, asset: assetResults });
  } catch (err) {
    return json({ ok: false, ...trace, error: err.message, stack: (err.stack || "").split("\n").slice(0, 3).join(" | ") }, 500);
  }
}
