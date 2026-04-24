export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const data = await request.json();
    const { username, password, action, id, is_admin } = data;

    // 1. 登录逻辑
    if (action === 'login') {
      const user = await env.DB.prepare("SELECT * FROM users WHERE username = ? AND password = ?")
        .bind(username, password)
        .first();

      if (user) {
        return new Response(JSON.stringify(user), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "用户名或密码错误" }), { status: 401 });
    }

    // 2. 获取用户列表
    if (action === 'list') {
      const result = await env.DB.prepare("SELECT id, username, is_admin, created_at FROM users ORDER BY created_at DESC").all();
      return new Response(JSON.stringify(result.results), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 3. 注册/添加用户
    if (action === 'register') {
      const result = await env.DB.prepare("INSERT INTO users (username, password, is_admin) VALUES (?, ?, ?)")
        .bind(username, password, is_admin || 0)
        .run();
      return new Response(JSON.stringify({ id: result.meta.last_row_id, success: true }));
    }

    // 4. 更新用户信息/修改密码
    if (action === 'update') {
      let query = "UPDATE users SET username = ?";
      const params = [username];
      
      if (password) {
        query += ", password = ?";
        params.push(password);
      }
      
      if (typeof is_admin !== 'undefined') {
        query += ", is_admin = ?";
        params.push(is_admin);
      }
      
      query += " WHERE id = ?";
      params.push(id);
      
      await env.DB.prepare(query).bind(...params).run();
      return new Response(JSON.stringify({ success: true }));
    }

    // 5. 删除用户
    if (action === 'delete') {
      await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
      return new Response(JSON.stringify({ success: true }));
    }

    return new Response(JSON.stringify({ error: "未知操作" }), { status: 400 });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
