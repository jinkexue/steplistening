export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const interview_id = url.searchParams.get("interview_id");

  try {
    if (!interview_id) {
      return new Response(JSON.stringify({ error: "interview_id is required" }), { status: 400 });
    }

    const result = await env.DB.prepare(
      "SELECT * FROM interview_audios WHERE interview_id = ? ORDER BY order_index ASC"
    ).bind(interview_id).all();

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
    const { action, id, interview_id, user_id, audio_key, duration, text, source, order_index } = data;

    if (action === 'add') {
      if (!interview_id) {
        return new Response(JSON.stringify({ error: "interview_id is required" }), { status: 400 });
      }
      const result = await env.DB.prepare(
        "INSERT INTO interview_audios (interview_id, audio_key, duration, text, source, order_index) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(interview_id, audio_key || null, duration || 0, text || '', source || 'manual', order_index || 1).run();

      return new Response(JSON.stringify({ 
        id: result.meta.last_row_id, 
        interview_id, 
        audio_key, 
        duration,
        text,
        source,
        order_index: order_index || 1 
      }), { status: 201 });
    }

    if (action === 'update') {
      if (!id) {
        return new Response(JSON.stringify({ error: "id is required" }), { status: 400 });
      }
      await env.DB.prepare(
        "UPDATE interview_audios SET audio_key = ?, duration = ?, text = ?, source = ? WHERE id = ?"
      ).bind(audio_key || null, duration || 0, text || null, source || 'manual', id).run();
      return new Response(JSON.stringify({ success: true }));
    }

    if (action === 'delete') {
      if (!id) {
        return new Response(JSON.stringify({ error: "id is required" }), { status: 400 });
      }
      await env.DB.prepare("DELETE FROM interview_audios WHERE id = ?").bind(id).run();
      return new Response(JSON.stringify({ success: true }));
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400 });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}