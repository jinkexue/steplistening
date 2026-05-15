export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const question_id = url.searchParams.get("question_id");

  try {
    if (!question_id) {
      return new Response(JSON.stringify({ error: "question_id is required" }), { status: 400 });
    }

    const result = await env.DB.prepare(
      "SELECT * FROM segments WHERE question_id = ? ORDER BY order_index ASC"
    ).bind(question_id).all();

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
    const { action, id, question_id, text, order_index } = data;

    if (action === 'add') {
      if (!question_id || !text) {
        return new Response(JSON.stringify({ error: "question_id and text are required" }), { status: 400 });
      }
      const result = await env.DB.prepare(
        "INSERT INTO segments (question_id, text, order_index) VALUES (?, ?, ?)"
      ).bind(question_id, text, order_index || 1).run();

      return new Response(JSON.stringify({ 
        id: result.meta.last_row_id, 
        question_id, 
        text, 
        order_index: order_index || 1 
      }), { status: 201 });
    }

    if (action === 'update') {
      if (!id) {
        return new Response(JSON.stringify({ error: "id is required" }), { status: 400 });
      }
      await env.DB.prepare("UPDATE segments SET text = ? WHERE id = ?").bind(text, id).run();
      return new Response(JSON.stringify({ success: true }));
    }

    if (action === 'delete') {
      if (!id) {
        return new Response(JSON.stringify({ error: "id is required" }), { status: 400 });
      }
      await env.DB.prepare("DELETE FROM segments WHERE id = ?").bind(id).run();
      return new Response(JSON.stringify({ success: true }));
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400 });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}