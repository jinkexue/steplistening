export async function onRequestPost(context) {
  const { request, env } = context;
  const contentType = request.headers.get("content-type") || "";

  try {
    // 1. 处理音频上传 (multipart/form-data)
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");
      const existingKey = formData.get("existingKey");
      const language = formData.get("language");

      if (!file || !(file instanceof File)) {
        return new Response(JSON.stringify({ error: "No file provided" }), { status: 400 });
      }

      const timestamp = Date.now();
      // 根据实际文件类型确定扩展名
      const mimeType = file.type || "audio/mpeg";
      let extension = "mp3";
      if (mimeType.includes("webm") || mimeType.includes("webm")) extension = "webm";
      else if (mimeType.includes("wav")) extension = "wav";
      else if (mimeType.includes("ogg")) extension = "ogg";
      else if (mimeType.includes("m4a") || mimeType.includes("mp4")) extension = "m4a";
      
      const filename = existingKey || `audio/${timestamp}.${extension}`;
      const arrayBuffer = await file.arrayBuffer();

      // 保存到 R2
      await env.BUCKET.put(filename, arrayBuffer, {
        httpMetadata: { contentType: mimeType },
      });

      // --- 自动识别文字 (AI) ---
      let autoText = "";
      try {
        if (env.AI) {
          const aiParams = {
            audio: [...new Uint8Array(arrayBuffer)],
          };
          if (language) aiParams.language = language;
          
          const aiResponse = await env.AI.run("@cf/openai/whisper", aiParams);
          autoText = aiResponse.text || "";
        }
      } catch (aiErr) {
        console.error("AI Transcription failed:", aiErr);
      }

      return new Response(JSON.stringify({ 
        success: true, 
        key: filename, 
        autoText: autoText 
      }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 2. 处理记录保存/更新/删除/插入 (application/json)
    if (contentType.includes("application/json")) {
      const data = await request.json();
      const { action, id, user_id, video_id, video_title, timestamp, duration, order_index, text, audio_key, total_duration, source } = data;

      // 保存视频元数据 (总时长)
      if (video_id && total_duration) {
        await env.DB.prepare("INSERT OR REPLACE INTO videos_meta (video_id, total_duration) VALUES (?, ?)")
          .bind(video_id, total_duration)
          .run();
      }

      if (action === 'delete') {
        await env.DB.prepare("DELETE FROM records WHERE id = ?").bind(id).run();
        // 重新排序索引
        await env.DB.prepare("UPDATE records SET order_index = order_index - 1 WHERE video_id = ? AND user_id = ? AND order_index > ?")
          .bind(video_id, user_id, order_index)
          .run();
        return new Response(JSON.stringify({ success: true }));
      }

      if (action === 'insert') {
        await env.DB.prepare("UPDATE records SET order_index = order_index + 1 WHERE video_id = ? AND user_id = ? AND order_index >= ?")
          .bind(video_id, user_id, order_index)
          .run();
        
        const result = await env.DB.prepare(
          "INSERT INTO records (user_id, video_id, video_title, timestamp, duration, order_index, text, audio_key, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
          .bind(user_id, video_id, video_title, timestamp, duration || 0, order_index, text || "", audio_key || null, source || 'manual')
          .run();
          
        return new Response(JSON.stringify({ id: result.meta.last_row_id, success: true, created_at: new Date().toISOString() }), { status: 201 });
      }

      if (id) {
        // 更新现有记录
        await env.DB.prepare("UPDATE records SET text = ?, audio_key = ?, source = ? WHERE id = ?")
          .bind(text, audio_key || null, source || 'manual', id)
          .run();
        return new Response(JSON.stringify({ success: true, id, created_at: new Date().toISOString() }));
      } else {
        // 创建新记录
        const result = await env.DB.prepare(
          "INSERT INTO records (user_id, video_id, video_title, timestamp, duration, order_index, text, audio_key, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
          .bind(user_id, video_id, video_title, timestamp, duration, order_index, text, audio_key, source || 'manual')
          .run();

        return new Response(JSON.stringify({ id: result.meta.last_row_id, success: true, created_at: new Date().toISOString() }), { status: 201 });
      }
    }

    return new Response(JSON.stringify({ error: "Unsupported content type" }), { status: 400 });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
