export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { username } = await request.json();
    if (!username) {
      return new Response(JSON.stringify({ error: "username is required" }), { status: 400 });
    }

    // 尝试查找现有用户
    const existing = await env.DB.prepare("SELECT * FROM users WHERE username = ?")
      .bind(username)
      .first();

    if (existing) {
      return new Response(JSON.stringify(existing), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 创建新用户
    const result = await env.DB.prepare("INSERT INTO users (username) VALUES (?)")
      .bind(username)
      .run();

    return new Response(
      JSON.stringify({
        id: result.meta.last_row_id,
        username,
        created_at: new Date().toISOString(),
      }),
      { status: 201, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

export async function onRequestGet(context) {
  const { env } = context;
  try {
    const result = await env.DB.prepare("SELECT id, username, created_at FROM users").all();
    return new Response(JSON.stringify(result.results), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
