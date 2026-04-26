export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const data = await request.json();
    const { action, userId } = data;

    // 验证用户权限（简单验证：检查是否为管理员或当前登录用户）
    if (!userId) {
      return new Response(JSON.stringify({ error: "需要登录" }), { status: 401 });
    }

    // 检查用户是否为管理员
    const user = await env.DB.prepare("SELECT is_admin FROM users WHERE id = ?").bind(userId).first();
    if (!user || !user.is_admin) {
      return new Response(JSON.stringify({ error: "需要管理员权限" }), { status: 403 });
    }

    if (action === 'check_columns') {
      // 检查vocab表的列是否存在
      const columns = await env.DB.prepare(
        "SELECT name FROM pragma_table_info('vocab') WHERE name IN ('efactor', 'interval', 'repetitions')"
      ).all();

      const existingColumns = columns.results.map(c => c.name);
      const missingColumns = [];

      if (!existingColumns.includes('efactor')) missingColumns.push('efactor');
      if (!existingColumns.includes('interval')) missingColumns.push('interval');
      if (!existingColumns.includes('repetitions')) missingColumns.push('repetitions');

      return new Response(JSON.stringify({
        success: true,
        existingColumns,
        missingColumns,
        needsMigration: missingColumns.length > 0
      }));
    }

    if (action === 'run_migration') {
      const results = [];

      // 检查并添加 efactor 列
      try {
        await env.DB.prepare("ALTER TABLE vocab ADD COLUMN efactor REAL DEFAULT 2.5").run();
        results.push({ column: 'efactor', status: 'added' });
      } catch (e) {
        if (e.message.includes('duplicate column') || e.message.includes('already exists')) {
          results.push({ column: 'efactor', status: 'already_exists' });
        } else {
          results.push({ column: 'efactor', status: 'error', error: e.message });
        }
      }

      // 检查并添加 interval 列
      try {
        await env.DB.prepare("ALTER TABLE vocab ADD COLUMN interval INTEGER DEFAULT 0").run();
        results.push({ column: 'interval', status: 'added' });
      } catch (e) {
        if (e.message.includes('duplicate column') || e.message.includes('already exists')) {
          results.push({ column: 'interval', status: 'already_exists' });
        } else {
          results.push({ column: 'interval', status: 'error', error: e.message });
        }
      }

      // 检查并添加 repetitions 列
      try {
        await env.DB.prepare("ALTER TABLE vocab ADD COLUMN repetitions INTEGER DEFAULT 0").run();
        results.push({ column: 'repetitions', status: 'added' });
      } catch (e) {
        if (e.message.includes('duplicate column') || e.message.includes('already exists')) {
          results.push({ column: 'repetitions', status: 'already_exists' });
        } else {
          results.push({ column: 'repetitions', status: 'error', error: e.message });
        }
      }

      const hasErrors = results.some(r => r.status === 'error');

      return new Response(JSON.stringify({
        success: !hasErrors,
        results,
        message: hasErrors ? '部分迁移失败' : '数据库迁移完成'
      }));
    }

    return new Response(JSON.stringify({ error: "未知的迁移操作" }), { status: 400 });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("user_id");

  if (!userId) {
    return new Response(JSON.stringify({ error: "需要登录" }), { status: 401 });
  }

  try {
    // 检查用户是否为管理员
    const user = await env.DB.prepare("SELECT is_admin FROM users WHERE id = ?").bind(userId).first();
    if (!user || !user.is_admin) {
      return new Response(JSON.stringify({ isAdmin: false }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ isAdmin: true }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
