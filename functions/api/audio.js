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

    return new Response(object.body, {
      headers: {
        "Content-Type": "audio/webm",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
