// ============================================================
// CELPIP 前端公共 JS
// - 复用 localStorage 里的 user_id / is_admin（由 index.html 登录时写入）
// - 统一 API 前缀
// ============================================================
const CELPIP_API_BASE = '/api';

function celpipGetUser() {
  try {
    const uid = localStorage.getItem('user_id');
    const admin = localStorage.getItem('is_admin');
    return {
      userId: uid ? Number(uid) : null,
      username: localStorage.getItem('username') || '',
      isAdmin: admin === '1' || admin === 'true',
    };
  } catch { return { userId: null, username: '', isAdmin: false }; }
}

function celpipRequireLogin() {
  const u = celpipGetUser();
  if (!u.userId) {
    alert('请先在主页登录');
    window.location.href = 'index.html';
    return null;
  }
  return u;
}

async function celpipApi(path, opts = {}) {
  const method = opts.method || 'GET';
  const url = CELPIP_API_BASE + path + (opts.query ? '?' + new URLSearchParams(opts.query).toString() : '');
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  let body;
  if (opts.body) body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  const res = await fetch(url, { method, headers, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function celpipRenderNav(active) {
  const u = celpipGetUser();
  const nav = document.createElement('div');
  nav.className = 'celpip-nav';
  nav.innerHTML = `
    <div class="celpip-nav-inner">
      <a href="index.html" class="celpip-brand">StepListening</a>
      <a href="index.html" class="celpip-nav-link">← 返回主页</a>
      <a href="celpip.html" class="celpip-nav-link ${active === 'home' ? 'active' : ''}">🎓 试卷广场</a>
      ${u.isAdmin ? `<a href="celpip-admin.html" class="celpip-nav-link ${active === 'admin' ? 'active' : ''}">⚙️ 管理员后台</a>` : ''}
      <div class="celpip-nav-right">
        ${u.userId ? `👤 ${u.username || 'User#' + u.userId}${u.isAdmin ? ' <span style="color:#F5A623">(admin)</span>' : ''}` : '<a href="index.html">请先登录</a>'}
      </div>
    </div>
  `;
  document.body.insertBefore(nav, document.body.firstChild);
}

function celpipSafeParse(s, fb) {
  try { return JSON.parse(s); } catch { return fb; }
}

function celpipAssetUrl(key) {
  return CELPIP_API_BASE + '/celpip/asset?key=' + encodeURIComponent(key);
}
