export async function onRequestGet(context) {
  const { request, env } = context;
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");

  if (!key) {
    return new Response(JSON.stringify({ error: "key is required" }), { status: 400 });
  }

  try {
    const object = await env.BUCKET.get(key);
    if (!object) {
      return new Response(JSON.stringify({ error: "Audio not found" }), { status: 404 });
    }

    // 根据文件扩展名或原始content-type确定MIME类型
    let contentType = object.httpMetadata?.contentType || 'audio/mpeg';
    if (key.endsWith('.mp3')) contentType = 'audio/mpeg';
    else if (key.endsWith('.webm')) contentType = 'audio/webm';
    else if (key.endsWith('.wav')) contentType = 'audio/wav';
    else if (key.endsWith('.ogg')) contentType = 'audio/ogg';
    else if (key.endsWith('.m4a')) contentType = 'audio/mp4';

    return new Response(object.body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}