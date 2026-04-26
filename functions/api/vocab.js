export async function onRequestGet(context) {
  const { request, env } = context;
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("user_id");
  const videoId = searchParams.get("video_id");
  const review = searchParams.get("review");

  if (!userId) {
    return new Response(JSON.stringify({ error: "user_id is required" }), { status: 400 });
  }

  try {
    let query = "SELECT * FROM vocab WHERE user_id = ?";
    const params = [userId];

    if (videoId) {
      query += " AND video_id = ?";
      params.push(videoId);
    }

    if (review === "true") {
      query += " AND next_review <= datetime('now')";
    }

    query += " ORDER BY created_at DESC";

    const result = await env.DB.prepare(query).bind(...params).all();
    return new Response(JSON.stringify(result.results), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  
  try {
    const data = await request.json();
    const { action, id, userId, videoId, videoTitle, timestamp, recordId, word, context: vocabContext, definition, level, status } = data;

    if (action === 'add') {
      const result = await env.DB.prepare(
        "INSERT INTO vocab (user_id, video_id, video_title, timestamp, record_id, word, context, definition) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
        .bind(userId, videoId, videoTitle, timestamp, recordId, word, vocabContext, definition)
        .run();
      return new Response(JSON.stringify({ id: result.meta.last_row_id, success: true }));
    }

    if (action === 'update') {
      await env.DB.prepare(
        "UPDATE vocab SET definition = ? WHERE id = ?"
      )
        .bind(definition, id)
        .run();
      return new Response(JSON.stringify({ success: true }));
    }

    if (action === 'review_v2') {
      // SM-2 算法实现（带向后兼容）
      const qualityMap = { fail: 1, blur: 3, success: 4 };
      const quality = qualityMap[status] || 3;
      const now = new Date();

      let vocabRecord;
      try {
        // 尝试获取SM-2参数
        vocabRecord = await env.DB.prepare(
          "SELECT efactor, interval, repetitions, level FROM vocab WHERE id = ?"
        ).bind(id).first();
      } catch (e) {
        // 如果字段不存在，回退到旧查询
        vocabRecord = await env.DB.prepare(
          "SELECT level FROM vocab WHERE id = ?"
        ).bind(id).first();
      }

      let efactor = vocabRecord?.efactor ?? 2.5;
      let interval = vocabRecord?.interval ?? 0;
      let repetitions = vocabRecord?.repetitions ?? 0;
      let currentLevel = vocabRecord?.level ?? 0;
      let newInterval;
      let newRepetitions = repetitions;
      let newEfactor = efactor;
      let newLevel = currentLevel;

      if (quality < 3) {
        newRepetitions = 0;
        newInterval = 1;
        newLevel = Math.max(0, currentLevel - 1);
        newEfactor = Math.max(1.3, efactor - 0.8);
      } else {
        newRepetitions = repetitions + 1;
        newLevel = Math.min(5, currentLevel + 1);

        if (newRepetitions === 1) {
          newInterval = 1;
        } else if (newRepetitions === 2) {
          newInterval = 6;
        } else {
          newInterval = Math.round(interval * efactor);
        }

        const qFactor = 5 - quality;
        newEfactor = efactor + (0.1 - qFactor * (0.08 + qFactor * 0.02));
        newEfactor = Math.max(1.3, newEfactor);
      }

      const nextReview = new Date(now.getTime() + newInterval * 24 * 60 * 60 * 1000);

      // 尝试更新SM-2字段，如果不存在则回退到旧版更新
      try {
        await env.DB.prepare(
          "UPDATE vocab SET level = ?, efactor = ?, interval = ?, repetitions = ?, next_review = ? WHERE id = ?"
        )
          .bind(newLevel, newEfactor, newInterval, newRepetitions, nextReview.toISOString(), id)
          .run();
      } catch (e) {
        // SM-2字段不存在，使用旧版更新
        await env.DB.prepare(
          "UPDATE vocab SET level = ?, next_review = ? WHERE id = ?"
        )
          .bind(newLevel, nextReview.toISOString(), id)
          .run();
      }

      return new Response(JSON.stringify({
        success: true,
        newInterval,
        newEfactor: Math.round(newEfactor * 100) / 100,
        newLevel,
        nextReview: nextReview.toISOString()
      }));
    }

    // 添加导出功能
    if (action === 'export') {
      const { format } = data; // 'csv' or 'mdx'

      // 获取用户的所有生词
      let vocabList;
      try {
        const result = await env.DB.prepare(
          "SELECT word, context, definition, level, next_review, created_at FROM vocab WHERE user_id = ? ORDER BY created_at DESC"
        ).bind(userId).all();
        vocabList = result.results;
      } catch (e) {
        return new Response(JSON.stringify({ error: "查询生词失败: " + e.message }), { status: 500 });
      }

      if (format === 'csv') {
        // CSV格式导出
        const headers = ['word', 'context', 'definition', 'level', 'next_review', 'created_at'];
        const csvContent = [
          headers.join(','),
          ...vocabList.map(v => {
            // 处理可能包含逗号或引号的字段
            const escape = (str) => {
              if (!str) return '';
              str = String(str).replace(/"/g, '""');
              if (str.includes(',') || str.includes('\n') || str.includes('"')) {
                return `"${str}"`;
              }
              return str;
            };
            return [
              escape(v.word),
              escape(v.context),
              escape(v.definition),
              v.level || 0,
              v.next_review || '',
              v.created_at || ''
            ].join(',');
          })
        ].join('\n');

        return new Response(csvContent, {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="vocab_export_${Date.now()}.csv"`
          }
        });
      }

      if (format === 'mdx') {
        // MDX格式导出 (MdxBuilder格式)
        // MDX格式: 单词\n定义\n</>\n
        const mdxContent = vocabList.map(v => {
          const word = v.word || '';
          const definition = v.definition || v.context || '';
          // MDX使用简单的分隔符格式
          return `${word}\n${definition}\n</>\n`;
        }).join('\n');

        return new Response(mdxContent, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Disposition': `attachment; filename="vocab_export_${Date.now()}.mdx"`
          }
        });
      }

      return new Response(JSON.stringify({ error: "不支持的格式" }), { status: 400 });
    }

    if (action === 'review') {
      // 记忆曲线逻辑 (Leitner System)
      // level: 0 -> 1 (1天), 1 -> 2 (2天), 2 -> 3 (4天), 3 -> 4 (7天), 4 -> 5 (15天)
      const intervals = [1, 2, 4, 7, 15, 30];
      const newLevel = Math.min(5, level + 1);
      const nextInterval = intervals[newLevel];
      
      await env.DB.prepare(
        "UPDATE vocab SET level = ?, next_review = datetime('now', '+' || ? || ' day') WHERE id = ?"
      )
        .bind(newLevel, nextInterval, id)
        .run();
      return new Response(JSON.stringify({ success: true, nextReview: nextInterval }));
    }

    if (action === 'fail') {
      // 复习失败，重置等级
      await env.DB.prepare(
        "UPDATE vocab SET level = 0, next_review = datetime('now', '+1 hour') WHERE id = ?"
      )
        .bind(id)
        .run();
      return new Response(JSON.stringify({ success: true }));
    }

    if (action === 'delete') {
      await env.DB.prepare("DELETE FROM vocab WHERE id = ?").bind(id).run();
      return new Response(JSON.stringify({ success: true }));
    }

    return new Response(JSON.stringify({ error: "未知操作" }), { status: 400 });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
