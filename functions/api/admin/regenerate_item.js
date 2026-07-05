// ============================================================
// POST /api/admin/regenerate_item
// 针对某道已有题目重新生成，覆盖原内容（保留 id / section_id / order_index / part or task）
// body: { user_id, item_id, section, with_asset?: boolean }
// 与 generate_one 共享 LLM 逻辑，仅使用 UPDATE 而非 INSERT
// ============================================================

import { requireAdmin, json } from "../../lib/auth.js";
import { loadSettings, volcChatJSON, pickEndpoint, pickModel, volcImage } from "../../lib/volc.js";

const TABLE = {
  listening: "celpip_listening_items",
  reading: "celpip_reading_items",
  writing: "celpip_writing_items",
  speaking: "celpip_speaking_items",
};

async function sha256Hex(text) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
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
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    bytes = arr;
  } else if (res instanceof ArrayBuffer || res instanceof Uint8Array) bytes = res;
  else throw new Error("Unknown TTS response");
  await env.BUCKET.put(r2Key, bytes, { httpMetadata: { contentType: "audio/mpeg" } });
  return r2Key;
}

async function genImage(env, settings, prompt) {
  const model = pickModel(settings, "image");
  const endpoint = pickEndpoint(settings, "image");
  if (!model) throw new Error("image_model not configured");
  const item = await volcImage({ apiKey: env.VOLC_API_KEY, endpoint, model, prompt, size: "2K" });
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
    const { item_id, section, with_asset = true } = await request.json();
    if (!item_id || !section) return json({ ok: false, stage: "validate", error: "item_id / section required" }, 400);
    const table = TABLE[section];
    if (!table) return json({ ok: false, stage: "validate", error: "invalid section" }, 400);
    if (!env.VOLC_API_KEY) return json({ ok: false, stage: "check_key", error: "VOLC_API_KEY not set" }, 500);

    trace.section = section;
    trace.item_id = item_id;

    // 读取原题以保留 part/task
    trace.stage = "load_item";
    const existing = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(item_id).first();
    if (!existing) return json({ ok: false, ...trace, error: "item not found" }, 404);
    const partOrTask = section === "writing" || section === "speaking" ? existing.task : existing.part;
    trace.part_or_task = partOrTask;

    // 预检 settings
    trace.stage = "load_settings";
    const settings = await loadSettings(env.DB);
    const endpoint = pickEndpoint(settings, "llm");
    const model = pickModel(settings, "llm");
    trace.endpoint = endpoint;
    trace.model = model;
    if (!endpoint || !model) return json({ ok: false, ...trace, error: "llm endpoint/model not configured" }, 400);

    // system prompt
    trace.stage = "load_prompt";
    const promptNames = {
      listening: "generate_dialogue", reading: "generate_passage",
      writing: "generate_prompt",     speaking: "generate_task",
    };
    const systemPrompt = await getSystemPrompt(env, section, promptNames[section]);
    if (!systemPrompt) return json({ ok: false, ...trace, error: `system prompt (${section}/${promptNames[section]}) missing` }, 500);

    // 组装 user prompt
    let userAsk;
    if (section === "listening") {
      userAsk = JSON.stringify({
        part: partOrTask,
        note: "REGENERATE this CELPIP Listening item with fresh content. Return strict JSON: {transcript, question, options:[...], answer}. Keep transcript 40-120 words.",
      });
    } else if (section === "reading") {
      userAsk = JSON.stringify({
        part: partOrTask,
        note: "REGENERATE this CELPIP Reading passage + 4-6 drop-down questions. Return strict JSON: {title, passage, questions:[{q, options:[...], answer}]}.",
      });
    } else if (section === "writing") {
      userAsk = JSON.stringify({
        task: partOrTask,
        note: partOrTask === 1
          ? "REGENERATE CELPIP Writing Task 1 (email). Return: {prompt, background, min_words:150, max_words:200}."
          : "REGENERATE CELPIP Writing Task 2 (survey response) with new chart_data {question, options:[{label, percent}]}. Return: {prompt, background, chart_data, min_words:150, max_words:200}.",
      });
    } else {
      userAsk = JSON.stringify({
        task: partOrTask,
        note: "REGENERATE CELPIP Speaking task. For Task 3/4 include image_prompt + vision_hints. Return: {prompt, image_prompt?, vision_hints?, prep_seconds, record_seconds}.",
      });
    }

    // 调 LLM
    trace.stage = "llm_call";
    let obj;
    try {
      obj = await volcChatJSON({
        apiKey: env.VOLC_API_KEY, endpoint, model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userAsk },
        ],
        max_tokens: 3500,
      });
    } catch (e) {
      return json({ ok: false, ...trace, error: `LLM 调用失败：${e.message}` }, 500);
    }

    // 覆盖 UPDATE
    trace.stage = "db_update";
    if (section === "listening") {
      const partLayout = obj.part_layout || (obj.segments ? "segmented" : (obj.image_prompts ? "multi_image_shared" : "shared_timer"));
      const questions = obj.questions || (obj.question ? [{ q: obj.question, options: obj.options || [], answer: obj.answer }] : []);
      const segments = obj.segments || (obj.transcript ? [{ transcript: obj.transcript, question_indices: questions.map((_, i) => i) }] : []);
      await env.DB.prepare(
        `UPDATE celpip_listening_items SET
          title=?, part_layout=?, segments_json=?, questions_json=?,
          image_prompts_json=?, image_keys_json=NULL, shared_timer_seconds=?,
          transcript=?, question=?, options=?, answer=?,
          audio_key=NULL, image_key=NULL
         WHERE id=?`
      ).bind(
        obj.title || "", partLayout,
        JSON.stringify(segments),
        JSON.stringify(questions),
        JSON.stringify(obj.image_prompts || []),
        obj.shared_timer_seconds || null,
        segments.map(s => s.transcript || "").join("\n\n"),
        questions[0]?.q || "",
        JSON.stringify(questions[0]?.options || []),
        String(questions[0]?.answer ?? ""),
        item_id
      ).run();
    } else if (section === "reading") {
      await env.DB.prepare(
        `UPDATE celpip_reading_items SET title=?, passage=?, questions=? WHERE id=?`
      ).bind(obj.title || "", obj.passage || "", JSON.stringify(obj.questions || []), item_id).run();
    } else if (section === "writing") {
      await env.DB.prepare(
        `UPDATE celpip_writing_items SET prompt=?, background=?, chart_data=?, min_words=?, max_words=? WHERE id=?`
      ).bind(
        obj.prompt || "", obj.background || "",
        JSON.stringify(obj.chart_data || null),
        obj.min_words || 150, obj.max_words || 200, item_id
      ).run();
    } else {
      await env.DB.prepare(
        `UPDATE celpip_speaking_items SET prompt=?, image_prompt=?, vision_hints=?, prep_seconds=?, record_seconds=?, image_key=NULL WHERE id=?`
      ).bind(
        obj.prompt || "", obj.image_prompt || null,
        JSON.stringify(obj.vision_hints || null),
        obj.prep_seconds || 30, obj.record_seconds || 60, item_id
      ).run();
    }

    // 附加资源（TTS/图片）
    const asset = {};
    if (with_asset && section === "listening") {
      trace.stage = "listening_tts";
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
      await env.DB.prepare(
        "UPDATE celpip_listening_items SET segments_json = ?, audio_key = ? WHERE id = ?"
      ).bind(JSON.stringify(newSegments), firstAudio, item_id).run();
      asset.audio_key = firstAudio;
      if (errors.length) asset.tts_error = errors.join(" | ");

      if (partLayout === "multi_image_shared" && Array.isArray(obj.image_prompts) && obj.image_prompts.length) {
        trace.stage = "listening_images";
        const imgKeys = [];
        const imgErrs = [];
        for (let i = 0; i < obj.image_prompts.length; i++) {
          try { imgKeys.push(await genImage(env, settings, obj.image_prompts[i])); }
          catch (e) { imgErrs.push(`img${i}: ${e.message}`); }
        }
        await env.DB.prepare(
          "UPDATE celpip_listening_items SET image_keys_json = ? WHERE id = ?"
        ).bind(JSON.stringify(imgKeys), item_id).run();
        asset.image_keys = imgKeys;
        if (imgErrs.length) asset.image_error = imgErrs.join(" | ");
      }
    }
    if (with_asset && section === "speaking" && obj.image_prompt && (partOrTask === 3 || partOrTask === 4)) {
      trace.stage = "speaking_image";
      try {
        const key = await genImage(env, settings, obj.image_prompt);
        await env.DB.prepare("UPDATE celpip_speaking_items SET image_key=? WHERE id=?").bind(key, item_id).run();
        asset.image_key = key;
      } catch (e) { asset.image_error = e.message; }
    }

    return json({ ok: true, ...trace, asset });
  } catch (err) {
    return json({ ok: false, ...trace, error: err.message }, 500);
  }
}
