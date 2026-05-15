-- 创建 users 表
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  is_admin INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 创建 videos_meta 表 (存储视频总时长)
CREATE TABLE IF NOT EXISTS videos_meta (
  video_id TEXT PRIMARY KEY,
  total_duration INTEGER DEFAULT 0
);

-- 创建 records 表
CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  video_id TEXT,
  video_title TEXT,
  timestamp INTEGER,
  duration INTEGER,
  order_index INTEGER,
  text TEXT NOT NULL,
  audio_key TEXT,
  source TEXT DEFAULT 'manual',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 创建 planned_tasks 表
CREATE TABLE IF NOT EXISTS planned_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  video_id TEXT NOT NULL,
  video_title TEXT,
  video_url TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 创建索引以优化查询性能
CREATE INDEX IF NOT EXISTS idx_records_user_id ON records(user_id);
CREATE INDEX IF NOT EXISTS idx_records_video_id ON records(video_id);
CREATE INDEX IF NOT EXISTS idx_planned_user_id ON planned_tasks(user_id);

-- 创建 vocab 表 (生词本)
CREATE TABLE IF NOT EXISTS vocab (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  video_id TEXT NOT NULL,
  video_title TEXT,
  timestamp INTEGER,
  record_id INTEGER,
  word TEXT NOT NULL,
  context TEXT,
  definition TEXT,
  level INTEGER DEFAULT 0, -- 记忆等级 (0-5)
  efactor REAL DEFAULT 2.5, -- SM-2简易度系数 (Easiness Factor)，默认2.5
  interval INTEGER DEFAULT 0, -- SM-2当前间隔天数
  repetitions INTEGER DEFAULT 0, -- SM-2连续成功复习次数
  next_review DATETIME DEFAULT CURRENT_TIMESTAMP, -- 下次复习时间
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_vocab_user_id ON vocab(user_id);
CREATE INDEX IF NOT EXISTS idx_vocab_video_id ON vocab(video_id);

-- 面试练习主表
CREATE TABLE IF NOT EXISTS interviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_interviews_user_id ON interviews(user_id);

-- 面试文字段落表
CREATE TABLE IF NOT EXISTS interview_texts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  interview_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  order_index INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (interview_id) REFERENCES interviews(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_interview_texts_interview_id ON interview_texts(interview_id);

-- 面试录音表
CREATE TABLE IF NOT EXISTS interview_audios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  interview_id INTEGER,
  question_id INTEGER,
  audio_key TEXT,
  duration INTEGER DEFAULT 0,
  text TEXT,
  source TEXT DEFAULT 'manual',
  order_index INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (interview_id) REFERENCES interviews(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_interview_audios_interview_id ON interview_audios(interview_id);
CREATE INDEX IF NOT EXISTS idx_interview_audios_question_id ON interview_audios(question_id);

-- 岗位表
CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_positions_user_id ON positions(user_id);

-- 面试问题表
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  position_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_questions_position_id ON questions(position_id);

-- 回答句子分段表
CREATE TABLE IF NOT EXISTS segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  order_index INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_segments_question_id ON segments(question_id);
