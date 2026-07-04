// ============================================================
// 管理员：一键生成试卷 orchestrator（M3 增强版）
// POST /api/admin/generate
// body: {
//   user_id, paper_id,
//   sections?: ['listening','reading','writing','speaking'],
//   options?: { listening_count?, reading_count?, writing_count?, speaking_count?,
//               difficulty?, tts?: boolean, image?: boolean }
// }
// M3 变更：
//   - Listening 默认生成 6 条（每 Part 一条），并自动调 Cloudflare TTS，音频落 R2 并写回 audio_key
//   - Reading / Writing / Speaking 保持每 section 1 条示例（M4/M5/M6 各自增强）
// ============================================================

import { requireAdmin, json } from "../../lib/auth.js";
import { loadSettings, volcChatJSON, pickEndpoint, pickModel } from "../../lib/volc.js";

const SECTION_LIST = ["listening", "reading", "writing", "speaking"];

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

async function sha256Hex(text) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// 直接调 Workers AI 生成 TTS 并写入 R2；返回 R2 key
// 生成 TTS 到 R2；provider 由 settings.tts_provider 决定
async function generateTTSToR2(env, settings, text) {
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
      headers: {
        "Authorization": `Bearer ${env.VOLC_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, input: text, voice: "alloy", response_format: "mp3" }),
    });
    if (!resp.ok) throw new Error(`volc TTS failed: ${resp.status} ${await resp.text()}`);
    const bytes = new Uint8Array(await resp.arrayBuffer());
    await env.BUCKET.put(r2Key, bytes, { httpMetadata: { contentType: "audio/mpeg" } });
    return r2Key;
  }

  // cloudflare
  const model = pickModel(settings, "cf_tts") || "@cf/deepgram/aura-2-en";
  const hash = await sha256Hex(`cf|${model}|${text}`);
  const r2Key = `celpip/tts/${hash}.mp3`;
  if (await env.BUCKET.head(r2Key)) return r2Key;
  const res = await env.AI.run(model, { text });
  let bytes;
  if (res instanceof ReadableStream) {
    const reader = res.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    bytes = new Blob(chunks);
  } else if (res?.audio) {
    const bin = atob(res.audio);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    bytes = arr;
  } else if (res instanceof ArrayBuffer || res instanceof Uint8Array) {
    bytes = res;
  } else {
    throw new Error("Unknown TTS response format");
  }
  await env.BUCKET.put(r2Key, bytes, { httpMetadata: { contentType: "audio/mpeg" } });
  return r2Key;
}

// 生成单个 listening item：LLM → 落库 → TTS → 更新 audio_key
async function genListeningItem({ env, sectionId, part, order, settings, systemPrompt, difficulty, wantTTS }) {
  const userAsk = JSON.stringify({
    difficulty,
    part,
    note: "Generate ONE authentic-sounding CELPIP Listening item for the specified Part. Keep transcript 30-120 words.",
  });
  const obj = await volcChatJSON({
    apiKey: env.VOLC_API_KEY,
    endpoint: pickEndpoint(settings, "llm"),
    model: pickModel(settings, "llm"),
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userAsk },
    ],
  });

  const ins = await env.DB.prepare(
    `INSERT INTO celpip_listening_items
       (section_id, part, transcript, question, options, answer, order_index)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    sectionId,
    part,
    obj.transcript || "",
    obj.question || "",
    JSON.stringify(obj.options || []),
    String(obj.answer ?? ""),
    order
  ).run();
  const itemId = ins.meta.last_row_id;

  if (wantTTS && obj.transcript) {
    try {
      const key = await generateTTSToR2(env, settings, obj.transcript);
      await env.DB.prepare(
        "UPDATE celpip_listening_items SET audio_key = ? WHERE id = ?"
      ).bind(key, itemId).run();
      return { id: itemId, tts: "ok", audio_key: key };
    } catch (e) {
      return { id: itemId, tts: "error", tts_error: e.message };
    }
  }
  return { id: itemId, tts: "skipped" };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const guard = await requireAdmin(request, env);
  if (!guard.ok) return guard.response;

  try {
    const { paper_id, sections, options = {} } = await request.json();
    if (!paper_id) return json({ error: "paper_id required" }, 400);
    const targetSections = sections && sections.length ? sections : SECTION_LIST;

    const settings = await loadSettings(env.DB);
    if (!env.VOLC_API_KEY) return json({ error: "VOLC_API_KEY not set" }, 500);

    const difficulty = options.difficulty || "CLB9";
    const wantTTS = options.tts !== false; // 默认开

    const summary = {};

    for (const section of targetSections) {
      const sectionId = await ensureSection(env, paper_id, section);
      summary[section] = { section_id: sectionId, items: [] };

      if (section === "listening") {
        const systemPrompt = await getSystemPrompt(env, "listening", "generate_dialogue");
        const count = Math.max(1, Math.min(8, options.listening_count || 6));
        for (let i = 0; i < count; i++) {
          const part = ((i) % 6) + 1;
          try {
            const r = await genListeningItem({
              env, sectionId, part, order: i + 1,
              settings, systemPrompt, difficulty, wantTTS,
            });
            summary.listening.items.push(r);
          } catch (e) {
            summary.listening.items.push({ error: e.message, part });
          }
        }
        continue;
      }

      // Reading：按 CELPIP 官方 4 个 Part 生成
      if (section === "reading") {
        const systemPrompt = await getSystemPrompt(env, "reading", "generate_passage");
        const count = Math.max(1, Math.min(6, options.reading_count || 4));
        for (let i = 0; i < count; i++) {
          const part = ((i) % 4) + 1;
          const userAsk = JSON.stringify({
            difficulty,
            part,
            note: "Generate ONE CELPIP Reading Part. Return strict JSON: {title, passage, questions:[{q, options, answer}]}. Keep 200-500 words for passage; 4-6 drop-down questions.",
          });
          try {
            const obj = await volcChatJSON({
              apiKey: env.VOLC_API_KEY,
              endpoint: pickEndpoint(settings, "llm"),
              model: pickModel(settings, "llm"),
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userAsk },
              ],
            });
            await env.DB.prepare(
              `INSERT INTO celpip_reading_items (section_id, part, title, passage, questions, order_index)
               VALUES (?, ?, ?, ?, ?, ?)`
            ).bind(
              sectionId, part,
              obj.title || "",
              obj.passage || "",
              JSON.stringify(obj.questions || []),
              i + 1
            ).run();
            summary.reading.items.push({ part, id: "generated" });
          } catch (e) {
            summary.reading.items.push({ error: e.message, part });
          }
        }
        continue;
      }

      // Writing：按 CELPIP 官方生成 Task 1 (email) + Task 2 (survey)
      if (section === "writing") {
        const systemPrompt = await getSystemPrompt(env, "writing", "generate_prompt");
        const tasksToGen = options.writing_tasks || [1, 2];
        let order = 0;
        for (const task of tasksToGen) {
          const userAsk = JSON.stringify({
            difficulty,
            task,
            note: task === 1
              ? "Generate CELPIP Writing Task 1 (email). Provide realistic scenario. Return strict JSON: {prompt, background, min_words:150, max_words:200}."
              : "Generate CELPIP Writing Task 2 (survey response). MUST include chart_data as JSON: {question, options:[{label, percent}]}. Return: {prompt, background, chart_data, min_words:150, max_words:200}.",
          });
          try {
            const obj = await volcChatJSON({
              apiKey: env.VOLC_API_KEY,
              endpoint: pickEndpoint(settings, "llm"),
              model: pickModel(settings, "llm"),
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userAsk },
              ],
            });
            order += 1;
            await env.DB.prepare(
              `INSERT INTO celpip_writing_items
                (section_id, task, prompt, background, chart_data, min_words, max_words, order_index)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
              sectionId, task,
              obj.prompt || "", obj.background || "",
              JSON.stringify(obj.chart_data || null),
              obj.min_words || 150, obj.max_words || 200,
              order
            ).run();
            summary.writing.items.push({ task, id: "generated" });
          } catch (e) {
            summary.writing.items.push({ error: e.message, task });
          }
        }
        continue;
      }

      // 其他 section 保持骨架（M6 会扩展 speaking）
      const nameMap = {
        speaking: "generate_task",
      };
      const systemPrompt = await getSystemPrompt(env, section, nameMap[section]);
      const userAsk = JSON.stringify({
        difficulty,
        part: 1,
        note: "Generate one representative item; return strict JSON.",
      });
      try {
        const obj = await volcChatJSON({
          apiKey: env.VOLC_API_KEY,
          endpoint: pickEndpoint(settings, "llm"),
          model: pickModel(settings, "llm"),
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userAsk },
          ],
        });

        if (section === "speaking") {
          await env.DB.prepare(
            `INSERT INTO celpip_speaking_items
              (section_id, task, prompt, image_prompt, vision_hints, prep_seconds, record_seconds)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            sectionId, 1,
            obj.prompt || "", obj.image_prompt || null,
            JSON.stringify(obj.vision_hints || null),
            obj.prep_seconds || 30, obj.record_seconds || 60
          ).run();
        }
        summary[section].items.push({ id: "generated" });
      } catch (e) {
        summary[section].items.push({ error: e.message });
      }
    }

    // 兼容旧字段：给每个 section 报个 generated 计数
    for (const s of Object.keys(summary)) {
      summary[s].generated = (summary[s].items || []).filter(x => !x.error).length;
      if ((summary[s].items || []).some(x => x.error)) {
        summary[s].error = "partial error";
      }
    }

    return json({ ok: true, summary });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
