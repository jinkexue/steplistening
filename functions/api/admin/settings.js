// ============================================================
// 管理员：读写 app_settings（火山 endpoint / model 引用名等）
// GET  /api/admin/settings?user_id=<adminId>
// POST /api/admin/settings   body: { user_id, updates: { key: value, ... } }
// 注意：VOLC_API_KEY 等敏感值走 wrangler secret，此接口只读引用名
// ============================================================

import { requireAdmin, json } from "../../lib/auth.js";
import { loadSettings, setSetting } from "../../lib/volc.js";

const ALLOWED_KEYS = new Set([
  "volc_api_endpoint",
  "volc_llm_model",
  "volc_vision_model",
  "volc_image_model",
  "volc_tts_model",
  "volc_stt_model",
  "cf_tts_model",
  "cf_stt_model",
]);

export async function onRequestGet(context) {
  const { request, env } = context;
  const guard = await requireAdmin(request, env);
  if (!guard.ok) return guard.response;

  try {
    const settings = await loadSettings(env.DB);
    return json({
      settings,
      // 只暴露 key 是否已设置（不返回明文）
      secrets: {
        VOLC_API_KEY: !!env.VOLC_API_KEY,
      },
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const guard = await requireAdmin(request, env);
  if (!guard.ok) return guard.response;

  try {
    const { updates } = await request.json();
    if (!updates || typeof updates !== "object") {
      return json({ error: "updates required" }, 400);
    }
    const applied = {};
    for (const [k, v] of Object.entries(updates)) {
      if (!ALLOWED_KEYS.has(k)) continue;
      await setSetting(env.DB, k, String(v ?? ""));
      applied[k] = v;
    }
    return json({ ok: true, applied });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
