import { requireAdmin, json } from "../../lib/auth.js";
import { loadSettings } from "../../lib/volc.js";
import { scanListeningMissing, scanSpeakingMissing } from "../../lib/partSpec.js";

/**
 * Auto-fix missing assets — 根据 Part / Task 类型扫描并补齐所有缺失的音频/图片。
 *
 * 请求 body：
 *   {
 *     user_id,
 *     section: 'listening' | 'speaking',
 *     item_id: number,
 *   }
 *
 * 逻辑：
 *   1. 读取该题当前状态
 *   2. 根据 partSpec 判断该题应有什么资源、缺失什么
 *   3. 并发调用内部的 regenerate_asset 逻辑，一次性补齐所有缺失
 *   4. 返回结果统计
 */

// 我们直接内部调用 regenerate_asset 的 POST 处理（同一 origin）— 但为了原子性和更好错误处理，
// 我们在这里 fetch 自己的 /api/admin/regenerate_asset 端点。
async function callRegen(request, env, body) {
  const url = new URL(request.url);
  const inner = new URL("/api/admin/regenerate_asset", url.origin);
  const resp = await fetch(inner.toString(), {
    method: "POST",
    headers: request.headers, // 转发 admin token 等
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({ ok: false, error: "invalid json" }));
  return { ok: resp.ok && data.ok !== false, data, status: resp.status };
}

export async function onRequestPost({ request, env }) {
  const guard = await requireAdmin(request, env);
  if (!guard.ok) return guard.resp;

  const body = await request.json().catch(() => ({}));
  const { section, item_id, user_id } = body;
  if (!section || !item_id) return json({ error: "section, item_id required" }, 400);

  let row, missing, actions;
  if (section === "listening") {
    row = await env.DB.prepare("SELECT * FROM celpip_listening_items WHERE id=?").bind(item_id).first();
    if (!row) return json({ error: "item not found" }, 404);
    ({ missing, actions } = scanListeningMissing(row));
  } else if (section === "speaking") {
    row = await env.DB.prepare("SELECT * FROM celpip_speaking_items WHERE id=?").bind(item_id).first();
    if (!row) return json({ error: "item not found" }, 404);
    ({ missing, actions } = scanSpeakingMissing(row));
  } else {
    return json({ error: "section must be listening or speaking" }, 400);
  }

  if (!actions.length) {
    return json({ ok: true, message: "Nothing to fix. All required assets present.", missing: [], results: [] });
  }

  // 并发执行所有补生动作（Cloudflare Pages Function 30s 硬限制）
  const results = await Promise.allSettled(
    actions.map(a => callRegen(request, env, {
      user_id,
      section,
      item_id,
      kind: a.kind,
      seg_index: a.seg_index,
      img_index: a.img_index,
    }))
  );
  const summary = results.map((r, i) => ({
    action: actions[i],
    ok: r.status === "fulfilled" && r.value.ok,
    detail: r.status === "fulfilled" ? r.value.data : { error: r.reason?.message || String(r.reason) },
  }));

  const okCount = summary.filter(s => s.ok).length;
  const failCount = summary.length - okCount;

  return json({
    ok: failCount === 0,
    scanned_missing: missing,
    total: summary.length,
    ok_count: okCount,
    fail_count: failCount,
    results: summary,
  });
}
