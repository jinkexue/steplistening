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
