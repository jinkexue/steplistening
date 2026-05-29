export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const question_id = url.searchParams.get("question_id");
  const segment_id = url.searchParams.get("segment_id");

  try {
    let query, params;
    if (segment_id) {
      query = "SELECT * FROM interview_audios WHERE segment_id = ? ORDER BY order_index ASC";
      params = segment_id;
    } else if (question_id) {
      query = "SELECT * FROM interview_audios WHERE question_id = ? ORDER BY order_index ASC";
      params = question_id;
    } else {
      return new Response(JSON.stringify({ error: "question_id or segment_id is required" }), { status: 400 });
    }

    const result = await env.DB.prepare(query).bind(params).all();

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
    const { action, id, question_id, segment_id, audio_key, duration, text, source, order_index } = data;

    if (action === 'add') {
      if (!question_id && !segment_id) {
        return new Response(JSON.stringify({ error: "question_id or segment_id is required" }), { status: 400 });
      }
      const result = await env.DB.prepare(
        "INSERT INTO interview_audios (question_id, segment_id, audio_key, duration, text, source, order_index) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind(question_id || 0, segment_id || 0, audio_key || null, duration || 0, text || '', source || 'manual', order_index || 1).run();

      return new Response(JSON.stringify({ 
        id: result.meta.last_row_id, 
        question_id: question_id || 0,
        segment_id: segment_id || 0,
        audio_key: audio_key || null, 
        duration: duration || 0,
        text: text || '',
        source: source || 'manual',
        order_index: order_index || 1 
      }), { status: 201 });
    }

    if (action === 'update') {
      if (!id) {
        return new Response(JSON.stringify({ error: "id is required" }), { status: 400 });
      }
      const updates = [];
      const values = [];
      if (audio_key !== undefined) { updates.push("audio_key = ?"); values.push(audio_key); }
      if (duration !== undefined) { updates.push("duration = ?"); values.push(duration); }
      if (text !== undefined) { updates.push("text = ?"); values.push(text); }
      if (source !== undefined) { updates.push("source = ?"); values.push(source); }
      values.push(id);
      
      if (updates.length > 0) {
        await env.DB.prepare(`UPDATE interview_audios SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();
      }
      return new Response(JSON.stringify({ success: true }));
    }

    if (action === 'delete') {
      if (!id) {
        return new Response(JSON.stringify({ error: "id is required" }), { status: 400 });
      }
      await env.DB.prepare("DELETE FROM interview_audios WHERE id = ?").bind(id).run();
      return new Response(JSON.stringify({ success: true }));
    }

    if (action === 'update_text') {
      if (!id || text === undefined) {
        return new Response(JSON.stringify({ error: "id and text are required" }), { status: 400 });
      }
      await env.DB.prepare("UPDATE interview_audios SET text = ? WHERE id = ?").bind(text, id).run();
      return new Response(JSON.stringify({ success: true }));
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400 });
  } catch (err) {
    console.error('interview_audio POST error:', err.message, err.stack);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}