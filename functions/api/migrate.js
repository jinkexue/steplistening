export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const data = await request.json();
    const { action, userId } = data;

    // 简化权限检查：只要登录就能执行迁移
    if (!userId) {
      // 非管理后台的迁移检查，允许不登录检查
      if (action === 'check_columns') {
        // 继续执行检查
      } else {
        return new Response(JSON.stringify({ error: "需要登录" }), { status: 401 });
      }
    } else {
      // 有userId时检查是否为管理员
      const user = await env.DB.prepare("SELECT is_admin FROM users WHERE id = ?").bind(userId).first();
      if (!user || !user.is_admin) {
        // 非管理员只能执行check_columns
        if (action !== 'check_columns') {
          return new Response(JSON.stringify({ error: "需要管理员权限" }), { status: 403 });
        }
      }
    }

    if (action === 'check_columns') {
      // 检查vocab表的列是否存在
      const vocabColumns = await env.DB.prepare(
        "SELECT name FROM pragma_table_info('vocab') WHERE name IN ('efactor', 'interval', 'repetitions')"
      ).all();

      const existingColumns = vocabColumns.results.map(c => c.name);
      const missingColumns = [];

      if (!existingColumns.includes('efactor')) missingColumns.push('efactor');
      if (!existingColumns.includes('interval')) missingColumns.push('interval');
      if (!existingColumns.includes('repetitions')) missingColumns.push('repetitions');

      // 检查interview_audios表的列是否存在
      const audioColumns = await env.DB.prepare(
        "SELECT name FROM pragma_table_info('interview_audios') WHERE name = 'segment_id'"
      ).all();
      
      const hasSegmentId = audioColumns.results.length > 0;
      if (!hasSegmentId) missingColumns.push('interview_audios.segment_id');

      // 检查questions表的order_index列
      const questionColumns = await env.DB.prepare(
        "SELECT name FROM pragma_table_info('questions') WHERE name = 'order_index'"
      ).all();
      
      const hasOrderIndex = questionColumns.results.length > 0;
      if (!hasOrderIndex) missingColumns.push('questions.order_index');

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

      // 检查并添加 segment_id 列到 interview_audios 表
      try {
        await env.DB.prepare("ALTER TABLE interview_audios ADD COLUMN segment_id INTEGER DEFAULT 0").run();
        results.push({ table: 'interview_audios', column: 'segment_id', status: 'added' });
      } catch (e) {
        if (e.message.includes('duplicate column') || e.message.includes('already exists')) {
          results.push({ table: 'interview_audios', column: 'segment_id', status: 'already_exists' });
        } else {
          results.push({ table: 'interview_audios', column: 'segment_id', status: 'error', error: e.message });
        }
      }

      // 检查并添加 order_index 列到 questions 表
      try {
        await env.DB.prepare("ALTER TABLE questions ADD COLUMN order_index INTEGER").run();
        results.push({ table: 'questions', column: 'order_index', status: 'added' });
      } catch (e) {
        if (e.message.includes('duplicate column') || e.message.includes('already exists')) {
          results.push({ table: 'questions', column: 'order_index', status: 'already_exists' });
        } else {
          results.push({ table: 'questions', column: 'order_index', status: 'error', error: e.message });
        }
      }
      
      // 确保所有问题的 order_index 都有值（初始化为 id）
      try {
        await env.DB.prepare("UPDATE questions SET order_index = id WHERE order_index IS NULL OR order_index = 0").run();
        results.push({ table: 'questions', column: 'order_index', status: 'initialized' });
      } catch (e) {
        results.push({ table: 'questions', column: 'order_index init', status: 'error', error: e.message });
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
