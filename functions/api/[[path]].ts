import { Hono } from 'hono';
import { handle } from 'hono/cloudflare-pages';
import { cors } from 'hono/cors';

interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
}

const app = new Hono<{ Bindings: Env }>().basePath('/api');

// 启用 CORS
app.use('*', cors());

// ============ 健康检查 ============
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============ 用户管理 ============

// 创建或获取用户 (简化逻辑：如果不存在就创建)
app.post('/users', async (c) => {
  try {
    const { username } = await c.req.json();
    
    if (!username || typeof username !== 'string') {
      return c.json({ error: 'Username is required' }, 400);
    }

    const db = c.env.DB;
    
    // 尝试查找现有用户
    const existing = await db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
    if (existing) {
      return c.json(existing);
    }

    // 创建新用户
    const result = await db.prepare(
      'INSERT INTO users (username) VALUES (?)'
    ).bind(username).run();

    return c.json({
      id: result.meta.last_row_id,
      username,
      created_at: new Date().toISOString()
    }, 201);
  } catch (err: any) {
    return c.json({ error: 'Failed to manage user' }, 500);
  }
});

// 获取所有用户
app.get('/users', async (c) => {
  try {
    const db = c.env.DB;
    const result = await db.prepare('SELECT id, username, created_at FROM users').all();
    return c.json(result.results);
  } catch (err) {
    return c.json({ error: 'Failed to fetch users' }, 500);
  }
});

// ============ 听写记录管理 ============

// 创建记录
app.post('/records', async (c) => {
  try {
    const { user_id, video_id, timestamp, text, audio_key } = await c.req.json();

    if (!user_id || !text) {
      return c.json({ error: 'user_id and text are required' }, 400);
    }

    const db = c.env.DB;
    const result = await db.prepare(
      'INSERT INTO records (user_id, video_id, timestamp, text, audio_key) VALUES (?, ?, ?, ?, ?)'
    ).bind(user_id, video_id || null, timestamp || null, text, audio_key || null).run();

    return c.json({
      id: result.meta.last_row_id,
      user_id,
      video_id: video_id || null,
      timestamp: timestamp || null,
      text,
      audio_key: audio_key || null,
      created_at: new Date().toISOString()
    }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to create record' }, 500);
  }
});

// 获取用户的所有记录
app.get('/users/:user_id/records', async (c) => {
  try {
    const user_id = c.req.param('user_id');
    const db = c.env.DB;
    const result = await db.prepare(
      'SELECT * FROM records WHERE user_id = ? ORDER BY created_at DESC'
    ).bind(user_id).all();

    return c.json(result.results);
  } catch (err) {
    return c.json({ error: 'Failed to fetch records' }, 500);
  }
});

// ============ 音频处理 ============

// 上传音频
app.post('/upload-audio', async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return c.json({ error: 'No file provided' }, 400);
    }

    const bucket = c.env.BUCKET;
    const timestamp = Date.now();
    const filename = `audio/${timestamp}-${file.name || 'recording.webm'}`;

    const arrayBuffer = await file.arrayBuffer();
    await bucket.put(filename, arrayBuffer, {
      httpMetadata: {
        contentType: file.type || 'audio/webm'
      }
    });

    return c.json({
      success: true,
      key: filename,
      size: file.size,
      uploadedAt: new Date().toISOString()
    }, 201);
  } catch (err) {
    console.error('Upload error:', err);
    return c.json({ error: 'Failed to upload audio' }, 500);
  }
});

// 获取音频
app.get('/audio/:path', async (c) => {
  try {
    const path = c.req.param('path');
    const bucket = c.env.BUCKET;
    
    const object = await bucket.get(`audio/${path}`);
    if (!object) {
      return c.json({ error: 'Audio not found' }, 404);
    }

    return new Response(object.body, {
      headers: {
        'Content-Type': 'audio/webm',
        'Cache-Control': 'public, max-age=3600'
      }
    });
  } catch (err) {
    return c.json({ error: 'Failed to fetch audio' }, 500);
  }
});

export const onRequest = handle(app);
