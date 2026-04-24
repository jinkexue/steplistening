export async function onRequestGet(context) {
  const { request, env } = context;
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("user_id");

  if (!userId) {
    return new Response(JSON.stringify({ error: "user_id is required" }), { status: 400 });
  }

  try {
    // 获取用户所有的视频任务列表，并统计每个视频的片段数量和录音总时长
    // 同时关联 videos_meta 获取视频总时长以计算完成度
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
