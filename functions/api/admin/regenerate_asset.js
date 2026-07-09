import { requireAdmin, json } from "../../lib/auth.js";
import { loadSettings, pickModel, volcImage, volcChatText, pickEndpoint } from "../../lib/volc.js";
import { synthesizeTTS } from "../../lib/ttsUnified.js";

/**
 * 根据 transcript / 上下文，自动推断一个短小的图片 prompt（<40 字英文）
 */
async function autoDeriveImagePrompt(env, settings, contextText, hint) {
  const sys = "You are a concise visual prompt writer for a CELPIP listening/speaking practice app. Given a scene description, output ONE short English text-to-image prompt (<40 words) that captures the setting, participants, and mood. Return ONLY the prompt, no quotes, no preface.";
  const user = `Context (may be dialogue transcript or task description):\n${(contextText || "").slice(0, 1200)}\n\nHint: ${hint || "generate a realistic still image suitable as scene background"}`;
  try {
    const out = await volcChatText({
      apiKey: env.VOLC_API_KEY,
      endpoint: pickEndpoint(settings, "text"),
      model: pickModel(settings, "text") || "doubao-pro-32k",
      system: sys,
      user,
      temperature: 0.7,
      max_tokens: 120,
    });
    return String(out || "").replace(/^["']|["']$/g, "").trim().slice(0, 300);
  } catch (e) {
    // 兜底：拿 context 前 80 字符直接当 prompt
    return String(contextText || "").slice(0, 80) + " realistic photo, well-lit, natural framing";
  }
}

/**
 * 单资源重新生成 — 只针对某道题的 audio 或 image（不重新生成文本）。
 *
 * 请求 body：
 *   {
 *     user_id,
 *     section:  'listening' | 'speaking',
 *     item_id:  number,
 *     kind:     'audio' | 'image' | 'image_keys' | 'seg_audio',
 *     seg_index: number   // 仅 kind='seg_audio' 时用
 *     img_index: number   // 仅 kind='image_keys' 时用（Part 5 多图，某张失败时补生成单张）
 *   }
 *
 * 说明：
 *   - audio (listening):       依据 segments_json[0].transcript 或 item.transcript 生成整段音频 → 写 audio_key & segments_json[0].audio_key
 *   - seg_audio (listening):   依据 segments_json[seg_index].transcript 生成，写 segments_json[seg_index].audio_key
 *   - image (listening/speaking): 依据 image_prompt 生成 image_key
 *   - image_keys (listening Part 5): 依据 image_prompts_json[img_index] 生成，写入 image_keys_json[img_index]
 */
export async function onRequestPost({ request, env }) {
  const guard = await requireAdmin(request, env);
  if (!guard.ok) return guard.resp;

  const body = await request.json().catch(() => ({}));
  const { section, item_id, kind } = body;
  const segIndex = Number(body.seg_index ?? -1);
  const imgIndex = Number(body.img_index ?? -1);

  if (!section || !item_id || !kind) {
    return json({ error: "section, item_id, kind required" }, 400);
  }

  const settings = await loadSettings(env);

  try {
    if (section === "listening") {
      const row = await env.DB.prepare(
        "SELECT * FROM celpip_listening_items WHERE id=?"
      ).bind(item_id).first();
      if (!row) return json({ error: "item not found" }, 404);

      const segments = safeParse(row.segments_json, []);
      const imagePrompts = safeParse(row.image_prompts_json, []);
      const imageKeys = safeParse(row.image_keys_json, []);

      if (kind === "audio") {
        // 整段音频（shared_timer 布局）
        const text = (row.transcript || "").trim() || (segments[0]?.transcript || "");
        if (!text) return json({ error: "no transcript text to synthesize" }, 400);
        const { r2Key } = await synthesizeTTS(env, settings, text);
        // 也更新 segments[0].audio_key（若结构存在）
        if (segments.length) {
          segments[0] = { ...(segments[0] || {}), audio_key: r2Key };
          await env.DB.prepare(
            "UPDATE celpip_listening_items SET audio_key=?, segments_json=? WHERE id=?"
          ).bind(r2Key, JSON.stringify(segments), item_id).run();
        } else {
          await env.DB.prepare(
            "UPDATE celpip_listening_items SET audio_key=? WHERE id=?"
          ).bind(r2Key, item_id).run();
        }
        return json({ ok: true, kind, audio_key: r2Key });
      }

      if (kind === "seg_audio") {
        if (segIndex < 0 || segIndex >= segments.length) return json({ error: "seg_index out of range" }, 400);
        const text = (segments[segIndex]?.transcript || "").trim();
        if (!text) return json({ error: "segment transcript empty" }, 400);
        const { r2Key } = await synthesizeTTS(env, settings, text);
        segments[segIndex] = { ...(segments[segIndex] || {}), audio_key: r2Key };
        // 若 seg 0 更新，也刷新顶层 audio_key
        const topAudio = segIndex === 0 ? r2Key : row.audio_key;
        await env.DB.prepare(
          "UPDATE celpip_listening_items SET segments_json=?, audio_key=? WHERE id=?"
        ).bind(JSON.stringify(segments), topAudio, item_id).run();
        return json({ ok: true, kind, seg_index: segIndex, audio_key: r2Key });
      }

      if (kind === "image") {
        // 单张图（Part 3/4 或口语）
        let prompt = imagePrompts[0] || row.image_prompt;
        let autoDerived = false;
        if (!prompt) {
          const ctx = (row.transcript || segments.map(s => s.transcript).filter(Boolean).join("\n") || "").slice(0, 1000);
          prompt = await autoDeriveImagePrompt(env, settings, ctx, "listening Part 3/4 background scene");
          autoDerived = true;
          // 顺便保存这个 prompt 到 image_prompts_json[0]（方便下次不用再推断）
          const newPrompts = imagePrompts.slice();
          newPrompts[0] = prompt;
          await env.DB.prepare(
            "UPDATE celpip_listening_items SET image_prompts_json=? WHERE id=?"
          ).bind(JSON.stringify(newPrompts), item_id).run();
        }
        const key = await volcImage(env, settings, prompt);
        await env.DB.prepare(
          "UPDATE celpip_listening_items SET image_key=? WHERE id=?"
        ).bind(key, item_id).run();
        return json({ ok: true, kind, image_key: key, auto_prompt: autoDerived, prompt_used: prompt });
      }

      if (kind === "image_keys") {
        // Part 5 多图
        let prompts = imagePrompts.slice();
        if (!prompts.length) {
          // 完全无 prompts，自动推断 2 条
          const ctx = (row.transcript || segments.map(s => s.transcript).filter(Boolean).join("\n") || "").slice(0, 1000);
          const [p1, p2] = await Promise.all([
            autoDeriveImagePrompt(env, settings, ctx, "3 speakers around a meeting table, mid-discussion"),
            autoDeriveImagePrompt(env, settings, ctx, "closeup of the discussion scene, natural expressions"),
          ]);
          prompts = [p1, p2];
          await env.DB.prepare(
            "UPDATE celpip_listening_items SET image_prompts_json=? WHERE id=?"
          ).bind(JSON.stringify(prompts), item_id).run();
        }
        if (imgIndex < 0) {
          // 全部并发重生
          const targets = prompts.slice(0, 2);
          const results = await Promise.allSettled(
            targets.map(p => volcImage(env, settings, p))
          );
          const newKeys = [];
          const errs = [];
          results.forEach((r, i) => {
            if (r.status === "fulfilled") newKeys.push(r.value);
            else errs.push(`img${i}: ${r.reason?.message || r.reason}`);
          });
          await env.DB.prepare(
            "UPDATE celpip_listening_items SET image_keys_json=? WHERE id=?"
          ).bind(JSON.stringify(newKeys), item_id).run();
          return json({ ok: true, kind, image_keys: newKeys, errors: errs.length ? errs.join(" | ") : undefined });
        }
        // 只重生单张
        if (imgIndex >= prompts.length) return json({ error: "img_index out of range" }, 400);
        const key = await volcImage(env, settings, prompts[imgIndex]);
        while (imageKeys.length <= imgIndex) imageKeys.push(null);
        imageKeys[imgIndex] = key;
        await env.DB.prepare(
          "UPDATE celpip_listening_items SET image_keys_json=? WHERE id=?"
        ).bind(JSON.stringify(imageKeys), item_id).run();
        return json({ ok: true, kind, img_index: imgIndex, image_key: key });
      }

      return json({ error: "unknown kind for listening: " + kind }, 400);
    }

    if (section === "speaking") {
      const row = await env.DB.prepare(
        "SELECT * FROM celpip_speaking_items WHERE id=?"
      ).bind(item_id).first();
      if (!row) return json({ error: "item not found" }, 404);
      if (kind === "image") {
        let prompt = row.image_prompt;
        let autoDerived = false;
        if (!prompt) {
          prompt = await autoDeriveImagePrompt(env, settings, row.prompt || "", `speaking task ${row.task} scene image`);
          autoDerived = true;
          await env.DB.prepare(
            "UPDATE celpip_speaking_items SET image_prompt=? WHERE id=?"
          ).bind(prompt, item_id).run();
        }
        const key = await volcImage(env, settings, prompt);
        await env.DB.prepare(
          "UPDATE celpip_speaking_items SET image_key=? WHERE id=?"
        ).bind(key, item_id).run();
        return json({ ok: true, kind, image_key: key, auto_prompt: autoDerived, prompt_used: prompt });
      }
      return json({ error: "speaking only supports kind=image" }, 400);
    }

    return json({ error: "section must be listening or speaking" }, 400);
  } catch (e) {
    return json({ ok: false, kind, error: e.message }, 500);
  }
}

function safeParse(s, def) {
  if (!s) return def;
  if (typeof s !== "string") return s;
  try { return JSON.parse(s); } catch { return def; }
}
