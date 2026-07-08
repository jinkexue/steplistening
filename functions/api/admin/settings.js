// ============================================================
// 管理员：读写 app_settings
// 每类模型独立配置 endpoint + model；TTS / STT 支持二选一 provider
// GET  /api/admin/settings?user_id=<adminId>
// POST /api/admin/settings   body: { user_id, updates: { key: value, ... } }
// ============================================================

import { requireAdmin, json } from "../../lib/auth.js";
import { loadSettings, setSetting } from "../../lib/volc.js";

// 允许写入的键（未在其中的会被忽略）
const ALLOWED_KEYS = new Set([
  // LLM
  "llm_endpoint",
  "llm_model",
  // Vision
  "vision_endpoint",
  "vision_model",
  "vision_same_as_llm",
  // Image (文生图)
  "image_endpoint",
  "image_model",
  // TTS
  "tts_provider",           // 'cloudflare' | 'volc'
  "tts_fallback_provider",  // 主失败时自动切换的备用 provider
  "cf_tts_model",           // Cloudflare 模型 id（如 @cf/deepgram/aura-2-en）
  "cf_tts_speaker",         // Cloudflare Aura-2 speaker 参数
  "cf_tts_speakers",        // Cloudflare 多角色映射
  "volc_tts_endpoint",
  "volc_tts_model",
  "volc_tts_speaker",
  "volc_tts_speakers",      // 火山多角色映射
  // STT
  "stt_provider",           // 'cloudflare' | 'volc'
  "cf_stt_model",
  "volc_stt_endpoint",
  "volc_stt_model",
  // 兼容旧字段（保留，方便老前端读取）
  "volc_api_endpoint",
]);

export async function onRequestGet(context) {
  const { request, env } = context;
  const guard = await requireAdmin(request, env);
  if (!guard.ok) return guard.response;

  try {
    const settings = await loadSettings(env.DB);
    return json({
      settings,
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
