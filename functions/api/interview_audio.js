export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const interview_id = url.searchParams.get("interview_id");
  const question_id = url.searchParams.get("question_id");

  try {
    if (!interview_id && !question_id) {
      return new Response(JSON.stringify({ error: "interview_id or question_id is required" }), { status: 400 });
    }

    let query = "";
    if (question_id) {
      query = "SELECT * FROM interview_audios WHERE question_id = ? ORDER BY order_index ASC";
      var params = question_id;
    } else {
      query = "SELECT * FROM interview_audios WHERE interview_id = ? ORDER BY order_index ASC";
      var params = interview_id;
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
    const { action, id, interview_id, question_id, user_id, audio_key, duration, text, source, order_index } = data;

    if (action === 'add') {
      if (!interview_id && !question_id) {
        return new Response(JSON.stringify({ error: "interview_id or question_id is required" }), { status: 400 });
      }
      const result = await env.DB.prepare(
        "INSERT INTO interview_audios (interview_id, question_id, audio_key, duration, text, source, order_index) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind(interview_id || null, question_id || null, audio_key || null, duration || 0, text || '', source || 'manual', order_index || 1).run();

      return new Response(JSON.stringify({ 
        id: result.meta.last_row_id, 
        interview_id: interview_id || null,
        question_id: question_id || null,
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
      // 动态构建更新字段
      const updates = [];
      const values = [];
      if (audio_key !== undefined) { updates.push("audio_key = ?"); values.push(audio_key || null); }
      if (duration !== undefined) { updates.push("duration = ?"); values.push(duration || 0); }
      if (text !== undefined) { updates.push("text = ?"); values.push(text || null); }
      if (source !== undefined) { updates.push("source = ?"); values.push(source || 'manual'); }
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

    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400 });
  } catch (err) {
    console.error('interview_audio error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}