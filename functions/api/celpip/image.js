// ============================================================
// POST /api/celpip/image
// 火山方舟文生图 → R2
// body: { prompt, size?, key_prefix? }
// return: { image_key, url?(存在则一起返回) }
// ============================================================

import { requireUser, json } from "../../lib/auth.js";
import { loadSettings, volcImage } from "../../lib/volc.js";

async function sha256Hex(text) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const guard = await requireUser(request, env);
  if (!guard.ok) return guard.response;

  try {
    const { prompt, size = "1024x1024", key_prefix = "celpip/speaking" } = await request.json();
    if (!prompt) return json({ error: "prompt required" }, 400);
    if (!env.VOLC_API_KEY) return json({ error: "VOLC_API_KEY missing" }, 500);

    const settings = await loadSettings(env.DB);
    const model = settings.volc_image_model;
    if (!model) return json({ error: "volc_image_model not configured" }, 500);

    const item = await volcImage({
      apiKey: env.VOLC_API_KEY,
      endpoint: settings.volc_api_endpoint,
      model,
      prompt,
      size,
    });

    // 取回图片字节
    let bytes;
    if (item.url) {
      const r = await fetch(item.url);
      if (!r.ok) throw new Error(`fetch image url failed: ${r.status}`);
      bytes = new Uint8Array(await r.arrayBuffer());
    } else if (item.b64_json) {
      const bin = atob(item.b64_json);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      throw new Error("volc image: no url or b64_json");
    }

    const hash = await sha256Hex(prompt + Date.now());
    const key = `${key_prefix.replace(/\/+$/, "")}/${hash}.png`;
    await env.BUCKET.put(key, bytes, {
      httpMetadata: { contentType: "image/png" },
    });
    return json({ image_key: key, source_url: item.url || null });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
