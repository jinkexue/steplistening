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
import { volcTTSHttp } from "../../lib/volcSpeech.js";

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
    // 火山 Agent Plan HTTP TTS
    // API Key 优先 VOLC_SPEECH_API_KEY（Agent Plan 专属），否则 fallback 到 VOLC_API_KEY
    const speechKey = env.VOLC_SPEECH_API_KEY || env.VOLC_API_KEY;
    const resourceId = pickModel(settings, "volc_tts") || "seed-tts-2.0";
    const speaker = (settings.volc_tts_speaker || "").trim() || "en_female_amanda_uranus_bigtts";
    const hash = await sha256Hex(`volc|${resourceId}|${speaker}|${text}`);
    const r2Key = `celpip/tts/${hash}.mp3`;
    if (await env.BUCKET.head(r2Key)) return r2Key;
    const bytes = await volcTTSHttp({
      apiKey: speechKey,
      text,
      resourceId,
      speaker,
    });
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
      // Part 级：把整个 Part 作为一条 record 生成
      userAsk = JSON.stringify({
        part: part_or_task,
        note: "Generate the FULL Part matching the specifications in system prompt. Follow the exact JSON shape for this Part number (segmented / shared_timer / multi_image_shared).",
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
      // 新版 Part 级：obj 可能是 {title, part_layout, segments, questions, ...} 或旧 {transcript, question, options, answer}
      const partLayout = obj.part_layout || (obj.segments ? "segmented" : (obj.image_prompts ? "multi_image_shared" : "shared_timer"));
      const questions = obj.questions || (obj.question ? [{ q: obj.question, options: obj.options || [], answer: obj.answer }] : []);
      const segments = obj.segments || (obj.transcript ? [{ transcript: obj.transcript, question_indices: questions.map((_, i) => i) }] : []);
      const sharedTimer = obj.shared_timer_seconds || null;

      const r = await env.DB.prepare(
        `INSERT INTO celpip_listening_items
          (section_id, part, order_index, title, part_layout,
           segments_json, questions_json, image_prompts_json, shared_timer_seconds,
           transcript, question, options, answer)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        sectionId, part_or_task, part_or_task,
        obj.title || "", partLayout,
        JSON.stringify(segments),
        JSON.stringify(questions),
        JSON.stringify(obj.image_prompts || []),
        sharedTimer,
        // 兼容旧字段（把整段 transcript 拼起来存一份，方便旧代码读取）
        segments.map(s => s.transcript || "").join("\n\n"),
        questions[0]?.q || "",
        JSON.stringify(questions[0]?.options || []),
        String(questions[0]?.answer ?? "")
      ).run();
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
    if (with_asset && section === "listening") {
      trace.stage = "listening_tts";
      // 从 questions_json / segments_json 拿到最新结构
      const partLayout = obj.part_layout || (obj.segments ? "segmented" : (obj.image_prompts ? "multi_image_shared" : "shared_timer"));
      const segments = obj.segments || (obj.transcript ? [{ transcript: obj.transcript, question_indices: [] }] : []);
      const newSegments = [];
      const errors = [];
      let firstAudio = null;
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i] || {};
        if (!seg.transcript) { newSegments.push(seg); continue; }
        try {
          const key = await tts(env, settings, seg.transcript);
          newSegments.push({ ...seg, audio_key: key });
          if (!firstAudio) firstAudio = key;
        } catch (e) {
          errors.push(`seg${i}: ${e.message}`);
          newSegments.push(seg);
        }
      }
      // 持久化：更新 segments_json 与顶层 audio_key（第一段）
      await env.DB.prepare(
        "UPDATE celpip_listening_items SET segments_json = ?, audio_key = ? WHERE id = ?"
      ).bind(JSON.stringify(newSegments), firstAudio, itemId).run();
      assetResults.audio_key = firstAudio;
      assetResults.segment_count = newSegments.length;
      if (errors.length) assetResults.tts_error = errors.join(" | ");

      // Part 5 多图
      if (partLayout === "multi_image_shared" && Array.isArray(obj.image_prompts) && obj.image_prompts.length) {
        trace.stage = "listening_images";
        const imgKeys = [];
        const imgErrs = [];
        for (let i = 0; i < obj.image_prompts.length; i++) {
          try {
            const key = await genImage(env, settings, obj.image_prompts[i]);
            imgKeys.push(key);
          } catch (e) {
            imgErrs.push(`img${i}: ${e.message}`);
          }
        }
        await env.DB.prepare(
          "UPDATE celpip_listening_items SET image_keys_json = ? WHERE id = ?"
        ).bind(JSON.stringify(imgKeys), itemId).run();
        assetResults.image_keys = imgKeys;
        if (imgErrs.length) assetResults.image_error = imgErrs.join(" | ");
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
