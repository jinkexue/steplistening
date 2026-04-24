export async function onRequestPost(context) {
  const { request, env } = context;
  const contentType = request.headers.get("content-type") || "";

  try {
    // 1. 处理音频上传 (multipart/form-data)
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");
      const existingKey = formData.get("existingKey");

      if (!file || !(file instanceof File)) {
        return new Response(JSON.stringify({ error: "No file provided" }), { status: 400 });
      }

      const timestamp = Date.now();
      const filename = existingKey || `audio/${timestamp}-${file.name || "recording.mp3"}`;
      const arrayBuffer = await file.arrayBuffer();

      await env.BUCKET.put(filename, arrayBuffer, {
        httpMetadata: { contentType: file.type || "audio/mpeg" },
      });

      return new Response(JSON.stringify({ success: true, key: filename }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 2. 处理记录保存 (application/json)
    if (contentType.includes("application/json")) {
      const data = await request.json();
      const { id, user_id, video_id, video_title, timestamp, duration, order_index, text, audio_key } = data;

      if (id) {
        // 更新现有记录
        await env.DB.prepare(
          "UPDATE records SET text = ?, audio_key = ? WHERE id = ?"
        )
          .bind(text, audio_key || null, id)
          .run();
        return new Response(JSON.stringify({ success: true, id, created_at: new Date().toISOString() }), {
          headers: { "Content-Type": "application/json" },
        });
      } else {
        // 创建新记录
        const result = await env.DB.prepare(
          "INSERT INTO records (user_id, video_id, video_title, timestamp, duration, order_index, text, audio_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
          .bind(user_id, video_id || null, video_title || null, timestamp || null, duration || null, order_index || 0, text, audio_key || null)
          .run();

        return new Response(
          JSON.stringify({
            id: result.meta.last_row_id,
            success: true,
            created_at: new Date().toISOString(),
          }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    return new Response(JSON.stringify({ error: "Unsupported content type" }), { status: 400 });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
