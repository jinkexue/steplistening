export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const user_id = url.searchParams.get("user_id");

  try {
    if (!user_id) {
      return new Response(JSON.stringify({ error: "user_id is required" }), { status: 400 });
    }

    // 获取岗位列表
    const result = await env.DB.prepare(`
      SELECT id, title, created_at FROM positions 
      WHERE user_id = ? 
      ORDER BY created_at DESC
    `).bind(user_id).all();

    return new Response(JSON.stringify(result.results), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const contentType = request.headers.get("content-type") || "";

  try {
    if (!contentType.includes("application/json")) {
      return new Response(JSON.stringify({ error: "Content-Type must be application/json" }), { status: 400 });
    }

    const data = await request.json();
    const { action, id, user_id, title } = data;

    if (action === 'create') {
      if (!user_id || !title) {
        return new Response(JSON.stringify({ error: "user_id and title are required" }), { status: 400 });
      }
      const result = await env.DB.prepare(
        "INSERT INTO positions (user_id, title) VALUES (?, ?)"
      ).bind(user_id, title).run();

      return new Response(JSON.stringify({ 
        id: result.meta.last_row_id, 
        user_id, 
        title, 
        created_at: new Date().toISOString() 
      }), { status: 201 });
    }

    if (action === 'delete') {
      if (!id || !user_id) {
        return new Response(JSON.stringify({ error: "id and user_id are required" }), { status: 400 });
      }
      await env.DB.prepare("DELETE FROM positions WHERE id = ? AND user_id = ?").bind(id, user_id).run();
      return new Response(JSON.stringify({ success: true }));
    }

    if (action === 'update') {
      if (!id || !title) {
        return new Response(JSON.stringify({ error: "id and title are required" }), { status: 400 });
      }
      await env.DB.prepare("UPDATE positions SET title = ? WHERE id = ?").bind(title, id).run();
      return new Response(JSON.stringify({ success: true }));
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400 });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}