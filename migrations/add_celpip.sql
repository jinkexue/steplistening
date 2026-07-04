-- ============================================================
-- CELPIP 模块数据库迁移
-- 覆盖：试卷 / 板块 / 4 类题目 / 作答进度 / 管理员配置 / 提示词模板
-- 兼容 Cloudflare D1 (SQLite)
-- ============================================================

-- 通用应用配置（火山方舟 endpoint / 各种 model 引用名等）
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- CELPIP 提示词模板（管理员可版本化调优）
CREATE TABLE IF NOT EXISTS celpip_prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section TEXT NOT NULL,          -- 'listening' | 'reading' | 'writing' | 'speaking' | 'scoring' | 'image'
  name TEXT NOT NULL,             -- 用于区分同一 section 下的不同用途
  system_prompt TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_celpip_prompts_section ON celpip_prompts(section);

-- 试卷主表：一份试卷 = 一次完整的 CELPIP 模拟考
CREATE TABLE IF NOT EXISTS celpip_papers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  difficulty TEXT DEFAULT 'CLB9', -- 目标 CLB 等级
  status TEXT DEFAULT 'draft',    -- draft | published
  created_by INTEGER,             -- admin user_id
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_celpip_papers_status ON celpip_papers(status);

-- 试卷内的 4 个板块（Listening / Reading / Writing / Speaking）
CREATE TABLE IF NOT EXISTS celpip_paper_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id INTEGER NOT NULL,
  section TEXT NOT NULL,          -- listening | reading | writing | speaking
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (paper_id) REFERENCES celpip_papers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_celpip_paper_sections_paper_id ON celpip_paper_sections(paper_id);

-- 听力题：一条 = 一小题（挂在 section 上，part 表示 CELPIP Part 1-6）
CREATE TABLE IF NOT EXISTS celpip_listening_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL,
  part INTEGER NOT NULL,
  audio_key TEXT,                 -- R2 音频对象 key
  image_key TEXT,                 -- 部分 Part 有静态图片
  transcript TEXT,                -- 原始对话文本（供 LLM 解析）
  question TEXT NOT NULL,
  options TEXT,                   -- JSON 数组
  answer TEXT,                    -- 正确答案（可为字母或索引）
  order_index INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (section_id) REFERENCES celpip_paper_sections(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_celpip_listening_section ON celpip_listening_items(section_id);

-- 阅读题：一条 = 一整段 passage + 若干 drop-down 小题（questions 用 JSON 存）
CREATE TABLE IF NOT EXISTS celpip_reading_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL,
  part INTEGER NOT NULL,
  title TEXT,
  passage TEXT NOT NULL,          -- 长文本 / 信件 / 邮件 / 表格
  questions TEXT NOT NULL,        -- JSON: [{q, options:[], answer}]
  order_index INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (section_id) REFERENCES celpip_paper_sections(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_celpip_reading_section ON celpip_reading_items(section_id);

-- 写作题：Task 1 写信 / Task 2 议题回复
CREATE TABLE IF NOT EXISTS celpip_writing_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL,
  task INTEGER NOT NULL,          -- 1 or 2
  prompt TEXT NOT NULL,
  background TEXT,                -- 背景说明
  chart_data TEXT,                -- JSON，Task 2 的饼图/百分比数据
  min_words INTEGER DEFAULT 150,
  max_words INTEGER DEFAULT 200,
  order_index INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (section_id) REFERENCES celpip_paper_sections(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_celpip_writing_section ON celpip_writing_items(section_id);

-- 口语题：8 个 Task，Task 3/4 需要图片
CREATE TABLE IF NOT EXISTS celpip_speaking_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL,
  task INTEGER NOT NULL,          -- 1 - 8
  prompt TEXT NOT NULL,
  image_key TEXT,                 -- R2 图片 key（Task 3/4 使用）
  image_prompt TEXT,              -- 生图用的 prompt（保留，便于重生成）
  vision_hints TEXT,              -- JSON: 结构化描述要点
  prep_seconds INTEGER DEFAULT 30,
  record_seconds INTEGER DEFAULT 60,
  order_index INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (section_id) REFERENCES celpip_paper_sections(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_celpip_speaking_section ON celpip_speaking_items(section_id);

-- 用户答题进度（按试卷+用户+题目粒度，断点续答）
CREATE TABLE IF NOT EXISTS celpip_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  section TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  answer_json TEXT,               -- 阅读/听力答案 JSON
  audio_key TEXT,                 -- 口语录音 R2 key
  transcript TEXT,                -- 口语转写
  essay TEXT,                     -- 写作内容
  score_json TEXT,                -- LLM 评分 JSON
  status TEXT DEFAULT 'in_progress', -- in_progress | submitted | graded
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (paper_id) REFERENCES celpip_papers(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_celpip_attempts_user ON celpip_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_celpip_attempts_paper ON celpip_attempts(paper_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_celpip_attempts ON celpip_attempts(paper_id, user_id, section, item_id);

-- 预置 AI 配置默认值（管理员后台可覆盖，敏感 Key 走 wrangler secret）
INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('volc_api_endpoint', 'https://ark.cn-beijing.volces.com/api/v3'),
  ('volc_llm_model',    ''),
  ('volc_vision_model', ''),
  ('volc_image_model',  ''),
  ('volc_tts_model',    ''),
  ('volc_stt_model',    ''),
  ('cf_tts_model',      '@cf/deepgram/aura-2-en'),
  ('cf_stt_model',      '@cf/openai/whisper');

-- 预置四大板块的默认提示词模板（管理员可编辑）
INSERT OR IGNORE INTO celpip_prompts (section, name, system_prompt) VALUES
  ('listening', 'generate_dialogue',
    'You are a CELPIP Listening item writer. Generate a natural Canadian-English dialogue that exactly matches the requested Part specification. Output strict JSON: {transcript, question, options:[A,B,C,D], answer}.'),
  ('reading', 'generate_passage',
    'You are a CELPIP Reading item writer. Produce a passage strictly matching the requested Part (email/notice/article/opinions). Output strict JSON: {title, passage, questions:[{q, options, answer}]}.'),
  ('writing', 'generate_prompt',
    'You are a CELPIP Writing item writer. Generate a Task 1 email prompt or Task 2 survey response prompt, following official CELPIP specifications. Output strict JSON: {prompt, background, chart_data?, min_words, max_words}.'),
  ('speaking', 'generate_task',
    'You are a CELPIP Speaking item writer. For Task 3/4 also output an "image_prompt" for a text-to-image model. Output strict JSON: {prompt, image_prompt?, vision_hints?, prep_seconds, record_seconds}.'),
  ('scoring', 'writing_score',
    'You are an official CELPIP Examiner. Evaluate the essay across four dimensions: Content/Coherence, Vocabulary, Readability, Task Fulfillment. Output strict JSON: {content_coherence, vocabulary, readability, task_fulfillment, overall_clb, feedback, rewritten_sample}.'),
  ('scoring', 'speaking_feedback',
    'You are an official CELPIP Examiner. Evaluate the transcript for fluency (proxied by words/duration), grammar errors, and lexical diversity. Output strict JSON: {fluency, grammar, vocabulary, overall_clb, suggestions:[...]}.'),
  ('image', 'speaking_task3_4',
    'You are an image-prompt generator for CELPIP Speaking Task 3/4. Produce a vivid, realistic scene prompt suitable for a text-to-image model, focused on everyday Canadian settings.');
