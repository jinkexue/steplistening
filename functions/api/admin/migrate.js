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
  // 一条记录 = 一个完整 Part（Part 1-6），根据 part_layout 决定前端布局
  //   segmented        : Part 1 / 2，多段音频、每段播完弹 1-3 题、每题独立倒计时（默认 30s/题）
  //   shared_timer     : Part 3 / 4 / 6，整段播完 + 单张（或无）静态图 + 一次性所有题 + 共享倒计时
  //   multi_image_shared: Part 5，整段播完 + 多张静态图 + 一次性所有题 + 共享倒计时
  `CREATE TABLE IF NOT EXISTS celpip_listening_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id INTEGER NOT NULL,
    part INTEGER NOT NULL,
    audio_key TEXT,
    image_key TEXT,
    transcript TEXT,
    question TEXT,
    options TEXT,
    answer TEXT,
    order_index INTEGER DEFAULT 1,
    -- 新版 Part 级字段（v2）：
    title TEXT,
    part_layout TEXT,
    segments_json TEXT,            -- [{audio_key, transcript, question_indices:[..]}]
    questions_json TEXT,           -- [{q, options:[...], answer, per_question_seconds?}]
    image_keys_json TEXT,          -- Part 5 多图
    image_prompts_json TEXT,       -- Part 5 多图 prompt
    shared_timer_seconds INTEGER,  -- Part 3/4/5/6 共享倒计时
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (section_id) REFERENCES celpip_paper_sections(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_celpip_listening_section ON celpip_listening_items(section_id)`,
  // v2 兼容：给旧库补列
  `ALTER TABLE celpip_listening_items ADD COLUMN title TEXT`,
  `ALTER TABLE celpip_listening_items ADD COLUMN part_layout TEXT`,
  `ALTER TABLE celpip_listening_items ADD COLUMN segments_json TEXT`,
  `ALTER TABLE celpip_listening_items ADD COLUMN questions_json TEXT`,
  `ALTER TABLE celpip_listening_items ADD COLUMN image_keys_json TEXT`,
  `ALTER TABLE celpip_listening_items ADD COLUMN image_prompts_json TEXT`,
  `ALTER TABLE celpip_listening_items ADD COLUMN shared_timer_seconds INTEGER`,
  `ALTER TABLE celpip_listening_items ADD COLUMN question_type TEXT`,

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
// 基于火山方舟官方最新 base URL（/api/plan/v3 是 OpenAI 兼容协议入口）
const SEED_SETTINGS = [
  // LLM：文本大模型（如 ark-code-latest）
  ["llm_endpoint", "https://ark.cn-beijing.volces.com/api/plan/v3"],
  ["llm_model",    "ark-code-latest"],
  // Vision：图文多模态（口语 Task 3/4 图片解析用；默认与 LLM 同源，vision_same_as_llm=1 时忽略下方字段）
  ["vision_same_as_llm", "1"],
  ["vision_endpoint", "https://ark.cn-beijing.volces.com/api/plan/v3"],
  ["vision_model",    ""],
  // Image：文生图（口语 Task 3/4 出图用，如 doubao-seedream-5.0-lite）
  ["image_endpoint", "https://ark.cn-beijing.volces.com/api/plan/v3/images/generations"],
  ["image_model",    "doubao-seedream-5.0-lite"],
  // TTS：默认走 Cloudflare Workers AI；切到 volc 需 Agent Plan 专属 Key（VOLC_SPEECH_API_KEY 或 VOLC_API_KEY）
  ["tts_provider",          "cloudflare"],
  ["tts_fallback_provider", ""],
  ["cf_tts_model",          "@cf/deepgram/aura-2-en"],
  ["cf_tts_speaker",        "thalia"],
  ["cf_tts_speakers",       "A|thalia, B|apollo, C|helena"],
  ["volc_tts_endpoint",     "https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional"],
  ["volc_tts_model",        "seed-tts-2.0"],
  ["volc_tts_speaker",      "en_female_dacey_uranus_bigtts"],
  ["volc_tts_speakers",     "A|en_female_dacey_uranus_bigtts, B|en_male_tim_uranus_bigtts, C|en_female_stokie_uranus_bigtts"],
  // STT：默认走 Cloudflare Whisper；火山 STT 是流式 WebSocket，尚未接入
  ["stt_provider",       "cloudflare"],
  ["cf_stt_model",       "@cf/openai/whisper"],
  ["volc_stt_endpoint",  ""],
  ["volc_stt_model",     "volc.seedasr.sauc.duration"],
  // 兼容旧字段
  ["volc_api_endpoint",  "https://ark.cn-beijing.volces.com/api/plan/v3"],
];

// 默认提示词（IGNORE：只有第一次插入）
const SEED_PROMPTS = [
  ["listening", "generate_dialogue",
    [
      'You are a CELPIP Listening item writer. Generate ONE full Part matching the official CELPIP Listening structure.',
      '',
      'PART SPECS (choose based on the part number in user message):',
      '  Part 1 — Practical Listening (Identifying Information):',
      '    A single storyline in a Canadian daily scenario (e.g. lost wallet at the mall, asking directions at a train station, clinic reception).',
      '    Split the story into 3 sequential audio segments (each 30-40s of natural spoken text).',
      '    After each segment: 2-3 questions with 4 options each. Total 8 questions (segment 1 = 2 questions, segment 2 = 3, segment 3 = 3).',
      '    part_layout = "segmented". per_question_seconds = 30.',
      '    CRITICAL: every segment MUST include question_indices — the 0-based indices into the questions array that belong to that segment.',
      '    Example: segments=[{transcript:"...", question_indices:[0,1]}, {transcript:"...", question_indices:[2,3,4]}, {transcript:"...", question_indices:[5,6,7]}], questions:[8 items].',
      '    Return JSON: {title, part_layout:"segmented", question_type:"radio", segments:[{transcript, question_indices:[i,...]}], questions:[{q,options:[A,B,C,D],answer}]}',
      '',
      '  Part 2 — Listening to a Daily-Life Conversation (Answering Questions):',
      '    5 independent short questions. Each question is a spoken one-liner (~5-10s).',
      '    Options are logical responses. Each question has its own 30s countdown.',
      '    part_layout = "segmented". Every question is its own segment.',
      '    CRITICAL: 5 segments (one per question), each segment.question_indices = [i] (just its own index).',
      '    Return JSON: {title, part_layout:"segmented", question_type:"radio", segments:[{transcript, question_indices:[i]}], questions:[{q,options,answer}]}',
      '',
      '  Part 3 — Listening for Information (Viewing a Conversation):',
      '    One continuous 1.5-2 minute two-person dialogue. 6 questions total.',
      '    IMPORTANT for multi-speaker rendering: format the transcript as line-per-turn dialogue',
      '    "A: <utterance>\\nB: <utterance>\\nA: ..." so the TTS pipeline can assign different voices.',
      '    Question format: DROPDOWN — each question is one blank in a summary paragraph.',
      '    part_layout = "shared_timer". shared_timer_seconds = 240.',
      '    Return JSON: {title, part_layout:"shared_timer", question_type:"dropdown", transcript, questions:[{q,options,answer}], shared_timer_seconds:240}',
      '',
      '  Part 4 — Listening to a News Item / Interview:',
      '    One continuous 2-2.5 minute interview or news report. 5 questions.',
      '    Format transcript as multi-speaker "Interviewer: ...\\nGuest: ..." so voices can be differentiated.',
      '    Question format: RADIO — 5 standard multiple-choice questions with 4 options each.',
      '    part_layout = "shared_timer". shared_timer_seconds = 180.',
      '    Return JSON: {title, part_layout:"shared_timer", question_type:"radio", transcript, questions:[{q,options,answer}], shared_timer_seconds:180}',
      '',
      '  Part 5 — Listening to a Discussion (Viewing a Discussion):',
      '    One continuous ~2 minute discussion involving 3 speakers. 8 questions.',
      '    Format transcript as multi-speaker "Alex: ...\\nBailey: ...\\nCasey: ..." (3 different names).',
      '    Provide EXACTLY 2 image_prompts for text-to-image (one showing all 3 speakers together, one showing the meeting/discussion scene). Keep prompts concise (< 40 words each) to reduce generation time.',
      '    Question format: RADIO — 8 radio-button questions referencing speakers by name/appearance.',
      '    part_layout = "multi_image_shared". shared_timer_seconds = 300.',
      '    Return JSON: {title, part_layout:"multi_image_shared", question_type:"radio", transcript, image_prompts:[...2 items...], questions:[{q,options,answer}], shared_timer_seconds:300}',
      '',
      '  Part 6 — Listening to Viewpoints:',
      '    Long ~3 minute academic monologue. 6 questions on deep comprehension.',
      '    Question format: DROPDOWN — 6 blanks in a summary paragraph, options are long paraphrased sentences.',
      '    part_layout = "shared_timer". shared_timer_seconds = 240.',
      '    Return JSON: {title, part_layout:"shared_timer", question_type:"dropdown", transcript, questions:[{q,options,answer}], shared_timer_seconds:240}',
      '',
      'Language: Natural Canadian English. Answer field: use letter (A/B/C/D).',
      'Output ONLY the JSON object matching the specified layout — no markdown, no commentary.',
    ].join('\n')],
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

  const url = new URL(request.url);
  const forcePrompts = url.searchParams.get("force_prompts") === "1";

  const results = [];
  try {
    for (const sql of STATEMENTS) {
      try {
        await env.DB.prepare(sql).run();
        results.push({ op: "ddl", status: "ok" });
      } catch (e) {
        // 幂等：列已存在时 ALTER 会报 "duplicate column"，视为成功
        if (/duplicate column/i.test(e.message) || /already exists/i.test(e.message)) {
          results.push({ op: "ddl", status: "skip", reason: "already exists" });
        } else {
          results.push({ op: "ddl", status: "error", error: e.message, sql: sql.slice(0, 60) });
        }
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
          "SELECT id, version FROM celpip_prompts WHERE section = ? AND name = ? ORDER BY version DESC LIMIT 1"
        ).bind(section, name).first();
        if (!exists) {
          await env.DB.prepare(
            "INSERT INTO celpip_prompts (section, name, system_prompt) VALUES (?, ?, ?)"
          ).bind(section, name, sp).run();
          results.push({ op: "seed_prompt", section, name, status: "inserted" });
        } else if (forcePrompts) {
          // 覆盖模式：追加新版本、旧版本 active=0
          await env.DB.prepare(
            "UPDATE celpip_prompts SET active = 0 WHERE section = ? AND name = ?"
          ).bind(section, name).run();
          const newVersion = (Number(exists.version) || 1) + 1;
          await env.DB.prepare(
            "INSERT INTO celpip_prompts (section, name, system_prompt, version, active) VALUES (?, ?, ?, ?, 1)"
          ).bind(section, name, sp, newVersion).run();
          results.push({ op: "seed_prompt", section, name, status: `forced v${newVersion}` });
        } else {
          results.push({ op: "seed_prompt", section, name, status: "exists (add ?force_prompts=1 to overwrite)" });
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
