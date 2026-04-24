export async function onRequestGet(context) {
  const { request, env } = context;
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("user_id");

  if (!userId) {
    return new Response(JSON.stringify({ error: "user_id is required" }), { status: 400 });
  }

  try {
    // 获取用户所有的视频任务列表，并统计每个视频的片段数量
    const result = await env.DB.prepare(`
      SELECT 
        video_id, 
        video_title, 
        COUNT(*) as record_count, 
        MAX(created_at) as last_activity 
      FROM records 
      WHERE user_id = ? 
      GROUP BY video_id 
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
