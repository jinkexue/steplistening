export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const position_id = url.searchParams.get("position_id");

  try {
    if (!position_id) {
      return new Response(JSON.stringify({ error: "position_id is required" }), { status: 400 });
    }

    const result = await env.DB.prepare(
      "SELECT * FROM questions WHERE position_id = ? ORDER BY id ASC"
    ).bind(position_id).all();

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
    const { action, id, position_id, user_id, title } = data;

    if (action === 'add') {
      if (!position_id || !title) {
        return new Response(JSON.stringify({ error: "position_id and title are required" }), { status: 400 });
      }
      const result = await env.DB.prepare(
        "INSERT INTO questions (position_id, title) VALUES (?, ?)"
      ).bind(position_id, title).run();

      return new Response(JSON.stringify({ 
        id: result.meta.last_row_id, 
        position_id, 
        title
      }), { status: 201 });
    }

    if (action === 'update') {
      if (!id || !title) {
        return new Response(JSON.stringify({ error: "id and title are required" }), { status: 400 });
      }
      await env.DB.prepare("UPDATE questions SET title = ? WHERE id = ?").bind(title, id).run();
      return new Response(JSON.stringify({ success: true }));
    }

    if (action === 'delete') {
      if (!id) {
        return new Response(JSON.stringify({ error: "id is required" }), { status: 400 });
      }
      await env.DB.prepare("DELETE FROM questions WHERE id = ?").bind(id).run();
      return new Response(JSON.stringify({ success: true }));
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400 });
  } catch (err) {
    console.error('question error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}