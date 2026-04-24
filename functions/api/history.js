export async function onRequestGet(context) {
  const { request, env } = context;
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("user_id");
  const videoId = searchParams.get("video_id");

  if (!userId || !videoId) {
    return new Response(JSON.stringify({ error: "user_id and video_id are required" }), { status: 400 });
  }

  try {
    const result = await env.DB.prepare(
      "SELECT * FROM records WHERE user_id = ? AND video_id = ? ORDER BY order_index ASC, created_at ASC"
    )
      .bind(userId, videoId)
      .all();

    return new Response(JSON.stringify(result.results), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
