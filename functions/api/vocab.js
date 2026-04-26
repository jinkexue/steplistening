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
      // SM-2 算法实现
      // 质量等级映射: fail=1(失败), blur=3(模糊/困难), success=4(顺利), perfect=5(完美)
      const qualityMap = { fail: 1, blur: 3, success: 4 };
      const quality = qualityMap[status] || 3;

      const now = new Date();

      // 获取当前单词的SM-2参数
      const vocabRecord = await env.DB.prepare(
        "SELECT efactor, interval, repetitions, level FROM vocab WHERE id = ?"
      ).bind(id).first();

      let efactor = vocabRecord?.efactor ?? 2.5;
      let interval = vocabRecord?.interval ?? 0;
      let repetitions = vocabRecord?.repetitions ?? 0;
      let currentLevel = vocabRecord?.level ?? 0;
      let newInterval;
      let newRepetitions = repetitions;
      let newEfactor = efactor;
      let newLevel = currentLevel;

      if (quality < 3) {
        // 回答质量低于3（失败或模糊）
        newRepetitions = 0;
        newInterval = 1; // 1天后重新复习
        newLevel = Math.max(0, currentLevel - 1); // 降级

        // 降低简易度系数 (EF = EF - 0.8)，但不低于1.3
        newEfactor = Math.max(1.3, efactor - 0.8);
      } else {
        // 回答质量>=3（成功）
        newRepetitions = repetitions + 1;
        newLevel = Math.min(5, currentLevel + 1); // 升级

        if (newRepetitions === 1) {
          newInterval = 1; // 第一次成功，1天后
        } else if (newRepetitions === 2) {
          newInterval = 6; // 第二次成功，6天后
        } else {
          // 第三次及以上，使用EF计算间隔
          newInterval = Math.round(interval * efactor);
        }

        // 更新简易度系数 (SM-2公式)
        // EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
        const qFactor = 5 - quality;
        newEfactor = efactor + (0.1 - qFactor * (0.08 + qFactor * 0.02));
        newEfactor = Math.max(1.3, newEfactor); // 不低于1.3
      }

      // 计算下次复习时间
      const nextReview = new Date(now.getTime() + newInterval * 24 * 60 * 60 * 1000);

      // 更新数据库
      await env.DB.prepare(
        "UPDATE vocab SET level = ?, efactor = ?, interval = ?, repetitions = ?, next_review = ? WHERE id = ?"
      )
        .bind(newLevel, newEfactor, newInterval, newRepetitions, nextReview.toISOString(), id)
        .run();

      return new Response(JSON.stringify({
        success: true,
        newInterval,
        newEfactor: Math.round(newEfactor * 100) / 100,
        newLevel,
        nextReview: nextReview.toISOString()
      }));
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
