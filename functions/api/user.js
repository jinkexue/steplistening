export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { username, password, action, newUser } = await request.json();

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

    // 2. 管理员添加/编辑用户
    if (action === 'manage') {
      const { adminId, targetUser } = newUser;
      const admin = await env.DB.prepare("SELECT is_admin FROM users WHERE id = ?").bind(adminId).first();
      
      if (!admin || !admin.is_admin) {
        return new Response(JSON.stringify({ error: "无权限" }), { status: 403 });
      }

      if (targetUser.id) {
        // 编辑
        await env.DB.prepare("UPDATE users SET username = ?, password = ?, is_admin = ? WHERE id = ?")
          .bind(targetUser.username, targetUser.password, targetUser.is_admin, targetUser.id)
          .run();
        return new Response(JSON.stringify({ success: true }));
      } else {
        // 添加
        const result = await env.DB.prepare("INSERT INTO users (username, password, is_admin) VALUES (?, ?, ?)")
          .bind(targetUser.username, targetUser.password, targetUser.is_admin)
          .run();
        return new Response(JSON.stringify({ id: result.meta.last_row_id, success: true }));
      }
    }

    return new Response(JSON.stringify({ error: "未知操作" }), { status: 400 });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const { searchParams } = new URL(request.url);
  const adminId = searchParams.get("adminId");

  try {
    const admin = await env.DB.prepare("SELECT is_admin FROM users WHERE id = ?").bind(adminId).first();
    if (!admin || !admin.is_admin) {
      return new Response(JSON.stringify({ error: "无权限" }), { status: 403 });
    }

    const result = await env.DB.prepare("SELECT id, username, password, is_admin, created_at FROM users").all();
    return new Response(JSON.stringify(result.results), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
