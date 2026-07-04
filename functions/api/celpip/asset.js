// ============================================================
// GET /api/celpip/asset?key=<r2Key>
// 通用 R2 静态资源直出（音频/图片），供前端 <Image/Audio> 直连
// ============================================================

export async function onRequestGet(context) {
  const { request, env } = context;
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  if (!key) return new Response(JSON.stringify({ error: "key required" }), { status: 400 });

  try {
    const obj = await env.BUCKET.get(key);
    if (!obj) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });

    let ct = obj.httpMetadata?.contentType || "";
    if (!ct) {
      if (key.endsWith(".mp3"))  ct = "audio/mpeg";
      else if (key.endsWith(".png"))  ct = "image/png";
      else if (key.endsWith(".jpg") || key.endsWith(".jpeg")) ct = "image/jpeg";
      else if (key.endsWith(".webp")) ct = "image/webp";
      else if (key.endsWith(".wav"))  ct = "audio/wav";
      else if (key.endsWith(".webm")) ct = "audio/webm";
      else ct = "application/octet-stream";
    }
    return new Response(obj.body, {
      headers: {
        "Content-Type": ct,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
