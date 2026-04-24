import { Hono } from 'hono';
import { cors } from 'hono/cors';

interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
}

const app = new Hono<{ Bindings: Env }>();

// 启用 CORS
app.use('*', cors());

// ============ 健康检查 ============
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============ 用户管理 ============

// 创建用户
app.post('/api/users', async (c) => {
  try {
    const { username } = await c.req.json();
    
    if (!username || typeof username !== 'string') {
      return c.json({ error: 'Username is required' }, 400);
    }

    const db = c.env.DB;
    const result = await db.prepare(
      'INSERT INTO users (username) VALUES (?)'
    ).bind(username).run();

    return c.json({
      id: result.meta.last_row_id,
      username,
      created_at: new Date().toISOString()
    }, 201);
  } catch (err: any) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'Username already exists' }, 409);
    }
    return c.json({ error: 'Failed to create user' }, 500);
  }
});

// 获取所有用户
app.get('/api/users', async (c) => {
  try {
    const db = c.env.DB;
    const result = await db.prepare('SELECT id, username, created_at FROM users').all();
    return c.json(result.results);
  } catch (err) {
    return c.json({ error: 'Failed to fetch users' }, 500);
  }
});

// 获取单个用户
app.get('/api/users/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const db = c.env.DB;
    const result = await db.prepare(
      'SELECT id, username, created_at FROM users WHERE id = ?'
    ).bind(id).first();

    if (!result) {
      return c.json({ error: 'User not found' }, 404);
    }
    return c.json(result);
  } catch (err) {
    return c.json({ error: 'Failed to fetch user' }, 500);
  }
});

// ============ 听写记录管理 ============

// 创建记录
app.post('/api/records', async (c) => {
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
app.get('/api/users/:user_id/records', async (c) => {
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

// 查询记录（支持过滤）
app.get('/api/records', async (c) => {
  try {
    const user_id = c.req.query('user_id');
    const video_id = c.req.query('video_id');
    const db = c.env.DB;

    let query = 'SELECT * FROM records WHERE 1=1';
    const params: any[] = [];

    if (user_id) {
      query += ' AND user_id = ?';
      params.push(user_id);
    }
    if (video_id) {
      query += ' AND video_id = ?';
      params.push(video_id);
    }

    query += ' ORDER BY created_at DESC';

    const result = await db.prepare(query).bind(...params).all();
    return c.json(result.results);
  } catch (err) {
    return c.json({ error: 'Failed to fetch records' }, 500);
  }
});

// 删除记录
app.delete('/api/records/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const db = c.env.DB;

    // 先获取记录以获取 audio_key
    const record = await db.prepare('SELECT audio_key FROM records WHERE id = ?').bind(id).first();

    if (!record) {
      return c.json({ error: 'Record not found' }, 404);
    }

    // 从 R2 删除音频文件
    if (record.audio_key) {
      const bucket = c.env.BUCKET;
      try {
        await bucket.delete(record.audio_key);
      } catch (err) {
        console.error('Failed to delete audio from R2:', err);
      }
    }

    // 从数据库删除记录
    await db.prepare('DELETE FROM records WHERE id = ?').bind(id).run();

    return c.json({ success: true, message: 'Record deleted' });
  } catch (err) {
    return c.json({ error: 'Failed to delete record' }, 500);
  }
});

// ============ 音频处理 ============

// 上传音频
app.post('/api/upload-audio', async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return c.json({ error: 'No file provided' }, 400);
    }

    const bucket = c.env.BUCKET;
    const timestamp = Date.now();
    const filename = `audio/${timestamp}-${file.name}`;

    const arrayBuffer = await file.arrayBuffer();
    const object = await bucket.put(filename, arrayBuffer, {
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
app.get('/api/audio/:path', async (c) => {
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

// 404 处理
app.notFound((c) => {
  return c.json({ error: 'Not Found' }, 404);
});

// 错误处理
app.onError((err, c) => {
  console.error('Error:', err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

export default app;
