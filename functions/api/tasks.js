export async function onRequestGet(context) {
  const { request, env } = context;
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("user_id");

  if (!userId) {
    return new Response(JSON.stringify({ error: "user_id is required" }), { status: 400 });
  }

  try {
    const result = await env.DB.prepare(`
      SELECT 
        r.video_id, 
        r.video_title, 
        COUNT(r.id) as record_count, 
        SUM(r.duration) as recorded_duration,
        v.total_duration,
        MAX(r.created_at) as last_activity 
      FROM records r
      LEFT JOIN videos_meta v ON r.video_id = v.video_id
      WHERE r.user_id = ? 
      GROUP BY r.video_id 
      ORDER BY last_activity DESC
    `)
      .bind(userId)
      .all();

    return new Response(JSON.stringify(result.results), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  
  try {
    const data = await request.json();
    const { action, userId, videoId, videoTitle } = data;

    if (action === 'delete') {
      // 删除该用户该视频的所有记录
      await env.DB.prepare("DELETE FROM records WHERE user_id = ? AND video_id = ?")
        .bind(userId, videoId)
        .run();
      return new Response(JSON.stringify({ success: true }));
    }

    if (action === 'add') {
      // 检查是否已存在
      const existing = await env.DB.prepare("SELECT id FROM records WHERE user_id = ? AND video_id = ? LIMIT 1")
        .bind(userId, videoId)
        .first();
      if (!existing) {
        // 插入一条空白记录以标记该视频已添加到任务列表
        await env.DB.prepare("INSERT INTO records (user_id, video_id, video_title, text) VALUES (?, ?, ?, '')")
          .bind(userId, videoId, videoTitle || '新任务')
          .run();
      }
      return new Response(JSON.stringify({ success: true }));
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400 });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
