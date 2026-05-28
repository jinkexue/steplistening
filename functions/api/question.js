export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const position_id = url.searchParams.get("position_id");

  try {
    if (!position_id) {
      return new Response(JSON.stringify({ error: "position_id is required" }), { status: 400 });
    }

    const result = await env.DB.prepare(
      "SELECT id, position_id, title FROM questions WHERE position_id = ? ORDER BY id ASC"
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
      // 获取当前最大排序值
      const maxOrder = await env.DB.prepare(
        "SELECT MAX(order_index) as max_order FROM questions WHERE position_id = ?"
      ).bind(position_id).all();
      const nextOrder = (maxOrder.results[0]?.max_order || 0) + 1;
      
      const result = await env.DB.prepare(
        "INSERT INTO questions (position_id, title, order_index) VALUES (?, ?, ?)"
      ).bind(position_id, title, nextOrder).run();

      return new Response(JSON.stringify({ 
        id: result.meta.last_row_id, 
        position_id, 
        title,
        order_index: nextOrder
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

    if (action === 'reorder') {
      if (!id || data.order_index === undefined) {
        return new Response(JSON.stringify({ error: "id and order_index are required" }), { status: 400 });
      }
      await env.DB.prepare("UPDATE questions SET order_index = ? WHERE id = ?").bind(data.order_index, id).run();
      return new Response(JSON.stringify({ success: true }));
    }

    if (action === 'move') {
      if (!id || !data.direction) {
        return new Response(JSON.stringify({ error: "id and direction are required" }), { status: 400 });
      }
      // 获取当前问题的position_id和order_index
      const current = await env.DB.prepare("SELECT position_id, order_index FROM questions WHERE id = ?").bind(id).all();
      if (!current.results.length) {
        return new Response(JSON.stringify({ error: "Question not found" }), { status: 404 });
      }
      const currentPos = current.results[0];
      
      let targetOrder;
      if (data.direction === 'up') {
        targetOrder = currentPos.order_index - 1;
      } else if (data.direction === 'down') {
        targetOrder = currentPos.order_index + 1;
      } else {
        return new Response(JSON.stringify({ error: "Invalid direction" }), { status: 400 });
      }
      
      // 查找目标位置的问题
      const target = await env.DB.prepare(
        "SELECT id FROM questions WHERE position_id = ? AND order_index = ?"
      ).bind(currentPos.position_id, targetOrder).all();
      
      if (target.results.length) {
        // 交换两个问题的排序值
        await env.DB.prepare("UPDATE questions SET order_index = ? WHERE id = ?").bind(currentPos.order_index, target.results[0].id).run();
        await env.DB.prepare("UPDATE questions SET order_index = ? WHERE id = ?").bind(targetOrder, id).run();
      }
      
      return new Response(JSON.stringify({ success: true }));
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400 });
  } catch (err) {
    console.error('question error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}