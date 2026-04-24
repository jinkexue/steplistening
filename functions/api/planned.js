export async function onRequestGet(context) {
  const { request, env } = context;
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("user_id");

  if (!userId) {
    return new Response(JSON.stringify({ error: "user_id is required" }), { status: 400 });
  }

  try {
    const result = await env.DB.prepare("SELECT * FROM planned_tasks WHERE user_id = ? ORDER BY created_at DESC")
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
  const { action, userId, videoId, videoTitle, videoUrl, id } = await request.json();

  try {
    if (action === 'add') {
      await env.DB.prepare("INSERT INTO planned_tasks (user_id, video_id, video_title, video_url) VALUES (?, ?, ?, ?)")
        .bind(userId, videoId, videoTitle, videoUrl)
        .run();
      return new Response(JSON.stringify({ success: true }));
    }

    if (action === 'delete') {
      await env.DB.prepare("DELETE FROM planned_tasks WHERE id = ? AND user_id = ?").bind(id, userId).run();
      return new Response(JSON.stringify({ success: true }));
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400 });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
