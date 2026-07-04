// ============================================================
// POST /api/admin/migrate
// 由管理员在 Web 后台手动触发：把 migrations/add_celpip.sql 里的 DDL
// 一次性内联到本文件里执行（Cloudflare Pages 不会读文件系统，只能内联）。
// 每次改表结构时，需要更新本文件里的 SQL 段并重新 push 到 GitHub。
// ============================================================

import { requireAdmin, json } from "../../lib/auth.js";

const STATEMENTS = [
  // ---------- app_settings ----------
  `CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  // ---------- celpip_prompts ----------
  `CREATE TABLE IF NOT EXISTS celpip_prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section TEXT NOT NULL,
    name TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    version INTEGER DEFAULT 1,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_celpip_prompts_section ON celpip_prompts(section)`,

  // ---------- celpip_papers ----------
  `CREATE TABLE IF NOT EXISTS celpip_papers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    difficulty TEXT DEFAULT 'CLB9',
    status TEXT DEFAULT 'draft',
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_celpip_papers_status ON celpip_papers(status)`,

  // ---------- celpip_paper_sections ----------
  `CREATE TABLE IF NOT EXISTS celpip_paper_sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id INTEGER NOT NULL,
    section TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (paper_id) REFERENCES celpip_papers(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_celpip_paper_sections_paper_id ON celpip_paper_sections(paper_id)`,

  // ---------- celpip_listening_items ----------
  `CREATE TABLE IF NOT EXISTS celpip_listening_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id INTEGER NOT NULL,
    part INTEGER NOT NULL,
    audio_key TEXT,
    image_key TEXT,
    transcript TEXT,
    question TEXT NOT NULL,
    options TEXT,
    answer TEXT,
    order_index INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (section_id) REFERENCES celpip_paper_sections(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_celpip_listening_section ON celpip_listening_items(section_id)`,

  // ---------- celpip_reading_items ----------
  `CREATE TABLE IF NOT EXISTS celpip_reading_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id INTEGER NOT NULL,
    part INTEGER NOT NULL,
    title TEXT,
    passage TEXT NOT NULL,
    questions TEXT NOT NULL,
    order_index INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (section_id) REFERENCES celpip_paper_sections(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_celpip_reading_section ON celpip_reading_items(section_id)`,

  // ---------- celpip_writing_items ----------
  `CREATE TABLE IF NOT EXISTS celpip_writing_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id INTEGER NOT NULL,
    task INTEGER NOT NULL,
    prompt TEXT NOT NULL,
    background TEXT,
    chart_data TEXT,
    min_words INTEGER DEFAULT 150,
    max_words INTEGER DEFAULT 200,
    order_index INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (section_id) REFERENCES celpip_paper_sections(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_celpip_writing_section ON celpip_writing_items(section_id)`,

  // ---------- celpip_speaking_items ----------
  `CREATE TABLE IF NOT EXISTS celpip_speaking_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id INTEGER NOT NULL,
    task INTEGER NOT NULL,
    prompt TEXT NOT NULL,
    image_key TEXT,
    image_prompt TEXT,
    vision_hints TEXT,
    prep_seconds INTEGER DEFAULT 30,
    record_seconds INTEGER DEFAULT 60,
    order_index INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (section_id) REFERENCES celpip_paper_sections(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_celpip_speaking_section ON celpip_speaking_items(section_id)`,

  // ---------- celpip_attempts ----------
  `CREATE TABLE IF NOT EXISTS celpip_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    section TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    answer_json TEXT,
    audio_key TEXT,
    transcript TEXT,
    essay TEXT,
    score_json TEXT,
    status TEXT DEFAULT 'in_progress',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (paper_id) REFERENCES celpip_papers(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_celpip_attempts_user ON celpip_attempts(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_celpip_attempts_paper ON celpip_attempts(paper_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_celpip_attempts ON celpip_attempts(paper_id, user_id, section, item_id)`,
];

// 默认设置（IGNORE 避免覆盖已有值）
const SEED_SETTINGS = [
  ["volc_api_endpoint", "https://ark.cn-beijing.volces.com/api/v3"],
  ["volc_llm_model",    ""],
  ["volc_vision_model", ""],
  ["volc_image_model",  ""],
  ["volc_tts_model",    ""],
  ["volc_stt_model",    ""],
  ["cf_tts_model",      "@cf/deepgram/aura-2-en"],
  ["cf_stt_model",      "@cf/openai/whisper"],
];

// 默认提示词（IGNORE：只有第一次插入）
const SEED_PROMPTS = [
  ["listening", "generate_dialogue",
    'You are a CELPIP Listening item writer. Generate a natural Canadian-English dialogue that exactly matches the requested Part specification. Output strict JSON: {transcript, question, options:[A,B,C,D], answer}.'],
  ["reading", "generate_passage",
    'You are a CELPIP Reading item writer. Produce a passage strictly matching the requested Part (email/notice/article/opinions). Output strict JSON: {title, passage, questions:[{q, options, answer}]}.'],
  ["writing", "generate_prompt",
    'You are a CELPIP Writing item writer. Generate a Task 1 email prompt or Task 2 survey response prompt, following official CELPIP specifications. Output strict JSON: {prompt, background, chart_data?, min_words, max_words}.'],
  ["speaking", "generate_task",
    'You are a CELPIP Speaking item writer. For Task 3/4 also output an "image_prompt" for a text-to-image model. Output strict JSON: {prompt, image_prompt?, vision_hints?, prep_seconds, record_seconds}.'],
  ["scoring", "writing_score",
    'You are an official CELPIP Examiner. Evaluate the essay across four dimensions: Content/Coherence, Vocabulary, Readability, Task Fulfillment. Output strict JSON: {content_coherence, vocabulary, readability, task_fulfillment, overall_clb, feedback, rewritten_sample}.'],
  ["scoring", "speaking_feedback",
    'You are an official CELPIP Examiner. Evaluate the transcript for fluency (proxied by words/duration), grammar errors, and lexical diversity. Output strict JSON: {fluency, grammar, vocabulary, overall_clb, suggestions:[...]}.'],
  ["image", "speaking_task3_4",
    'You are an image-prompt generator for CELPIP Speaking Task 3/4. Produce a vivid, realistic scene prompt suitable for a text-to-image model, focused on everyday Canadian settings.'],
];

export async function onRequestPost(context) {
  const { request, env } = context;
  const guard = await requireAdmin(request, env);
  if (!guard.ok) return guard.response;

  const results = [];
  try {
    for (const sql of STATEMENTS) {
      try {
        await env.DB.prepare(sql).run();
        results.push({ op: "ddl", status: "ok" });
      } catch (e) {
        results.push({ op: "ddl", status: "error", error: e.message, sql: sql.slice(0, 60) });
      }
    }
    for (const [k, v] of SEED_SETTINGS) {
      try {
        await env.DB.prepare(
          "INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)"
        ).bind(k, v).run();
        results.push({ op: "seed_setting", key: k, status: "ok" });
      } catch (e) {
        results.push({ op: "seed_setting", key: k, status: "error", error: e.message });
      }
    }
    for (const [section, name, sp] of SEED_PROMPTS) {
      try {
        const exists = await env.DB.prepare(
          "SELECT id FROM celpip_prompts WHERE section = ? AND name = ?"
        ).bind(section, name).first();
        if (!exists) {
          await env.DB.prepare(
            "INSERT INTO celpip_prompts (section, name, system_prompt) VALUES (?, ?, ?)"
          ).bind(section, name, sp).run();
          results.push({ op: "seed_prompt", section, name, status: "inserted" });
        } else {
          results.push({ op: "seed_prompt", section, name, status: "exists" });
        }
      } catch (e) {
        results.push({ op: "seed_prompt", section, name, status: "error", error: e.message });
      }
    }
    return json({ ok: true, results });
  } catch (err) {
    return json({ error: err.message, results }, 500);
  }
}

export async function onRequestGet(context) {
  return json({
    hint: "POST /api/admin/migrate as an admin user to apply CELPIP schema migrations.",
    statements_count: STATEMENTS.length,
    seed_settings: SEED_SETTINGS.length,
    seed_prompts: SEED_PROMPTS.length,
  });
}
