// ============================================================
// 简单的鉴权/管理员校验工具
// 现有系统通过 user_id 传参，无 token 中间件；这里先做“存在且是 admin”校验
// 后续若加 session/token，此处集中升级即可
// ============================================================

/**
 * 从 URL 或 body 中解析 user_id
 */
export async function extractUserId(request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("user_id");
  if (q) return Number(q);
  // 尝试从 body 里读
  try {
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const clone = request.clone();
      const body = await clone.json();
      if (body?.user_id) return Number(body.user_id);
    }
  } catch (_) { /* ignore */ }
  return null;
}

/**
 * 校验是否管理员
 * @returns {Promise<{ok:true, user:any} | {ok:false, response:Response}>}
 */
export async function requireAdmin(request, env) {
  const userId = await extractUserId(request);
  if (!userId) {
    return {
      ok: false,
      response: json({ error: "user_id required" }, 401),
    };
  }
  const user = await env.DB.prepare(
    "SELECT id, username, is_admin FROM users WHERE id = ?"
  ).bind(userId).first();
  if (!user) {
    return { ok: false, response: json({ error: "user not found" }, 404) };
  }
  if (!user.is_admin) {
    return { ok: false, response: json({ error: "admin only" }, 403) };
  }
  return { ok: true, user };
}

/**
 * 校验是否登录用户（不要求 admin）
 */
export async function requireUser(request, env) {
  const userId = await extractUserId(request);
  if (!userId) {
    return { ok: false, response: json({ error: "user_id required" }, 401) };
  }
  const user = await env.DB.prepare(
    "SELECT id, username, is_admin FROM users WHERE id = ?"
  ).bind(userId).first();
  if (!user) {
    return { ok: false, response: json({ error: "user not found" }, 404) };
  }
  return { ok: true, user };
}

/**
 * 快速 JSON 响应封装
 */
export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}
