export async function onRequestPost(context) {
  const { request, env } = context;
  const contentType = request.headers.get("content-type") || "";

  try {
    // 1. 处理音频上传 (multipart/form-data)
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");

      if (!file || !(file instanceof File)) {
        return new Response(JSON.stringify({ error: "No file provided" }), { status: 400 });
      }

      const timestamp = Date.now();
      const filename = `audio/${timestamp}-${file.name || "recording.webm"}`;
      const arrayBuffer = await file.arrayBuffer();

      await env.BUCKET.put(filename, arrayBuffer, {
        httpMetadata: { contentType: file.type || "audio/webm" },
      });

      return new Response(JSON.stringify({ success: true, key: filename }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 2. 处理记录保存 (application/json)
    if (contentType.includes("application/json")) {
      const { user_id, video_id, timestamp, text, audio_key } = await request.json();

      if (!user_id || !text) {
        return new Response(JSON.stringify({ error: "user_id and text are required" }), { status: 400 });
      }

      const result = await env.DB.prepare(
        "INSERT INTO records (user_id, video_id, timestamp, text, audio_key) VALUES (?, ?, ?, ?, ?)"
      )
        .bind(user_id, video_id || null, timestamp || null, text, audio_key || null)
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

    return new Response(JSON.stringify({ error: "Unsupported content type" }), { status: 400 });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
