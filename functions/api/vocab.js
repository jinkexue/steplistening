export async function onRequestGet(context) {
  const { request, env } = context;
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("user_id");
  const videoId = searchParams.get("video_id");
  const review = searchParams.get("review");

  if (!userId) {
    return new Response(JSON.stringify({ error: "user_id is required" }), { status: 400 });
  }

  try {
    let query = "SELECT * FROM vocab WHERE user_id = ?";
    const params = [userId];

    if (videoId) {
      query += " AND video_id = ?";
      params.push(videoId);
    }

    if (review === "true") {
      query += " AND next_review <= datetime('now')";
    }

    query += " ORDER BY created_at DESC";

    const result = await env.DB.prepare(query).bind(...params).all();
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
    const { action, id, userId, videoId, word, context: vocabContext, definition, level } = data;

    if (action === 'add') {
      const result = await env.DB.prepare(
        "INSERT INTO vocab (user_id, video_id, word, context, definition) VALUES (?, ?, ?, ?, ?)"
      )
        .bind(userId, videoId, word, vocabContext, definition)
        .run();
      return new Response(JSON.stringify({ id: result.meta.last_row_id, success: true }));
    }

    if (action === 'update') {
      await env.DB.prepare(
        "UPDATE vocab SET definition = ? WHERE id = ?"
      )
        .bind(definition, id)
        .run();
      return new Response(JSON.stringify({ success: true }));
    }

    if (action === 'review') {
      // 记忆曲线逻辑 (Leitner System)
      // level: 0 -> 1 (1天), 1 -> 2 (2天), 2 -> 3 (4天), 3 -> 4 (7天), 4 -> 5 (15天)
      const intervals = [1, 2, 4, 7, 15, 30];
      const newLevel = Math.min(5, level + 1);
      const nextInterval = intervals[newLevel];
      
      await env.DB.prepare(
        "UPDATE vocab SET level = ?, next_review = datetime('now', '+' || ? || ' day') WHERE id = ?"
      )
        .bind(newLevel, nextInterval, id)
        .run();
      return new Response(JSON.stringify({ success: true, nextReview: nextInterval }));
    }

    if (action === 'fail') {
      // 复习失败，重置等级
      await env.DB.prepare(
        "UPDATE vocab SET level = 0, next_review = datetime('now', '+1 hour') WHERE id = ?"
      )
        .bind(id)
        .run();
      return new Response(JSON.stringify({ success: true }));
    }

    if (action === 'delete') {
      await env.DB.prepare("DELETE FROM vocab WHERE id = ?").bind(id).run();
      return new Response(JSON.stringify({ success: true }));
    }

    return new Response(JSON.stringify({ error: "未知操作" }), { status: 400 });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
