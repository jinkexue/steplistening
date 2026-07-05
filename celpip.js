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

/**
 * 可复制的消息对话框（替代 alert，方便复制错误信息）
 * @param {string} title  弹窗标题
 * @param {string} body   消息正文，会自动换行
 * @param {'info'|'success'|'error'} level  颜色主题
 */
function celpipShowMessage(title, body, level = 'info') {
  const existing = document.getElementById('celpipMsgModal');
  if (existing) existing.remove();
  const color = { info: '#0055A4', success: '#2E9F5B', error: '#D64545' }[level] || '#0055A4';
  const modal = document.createElement('div');
  modal.id = 'celpipMsgModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="background:#FFF;border-radius:12px;padding:20px;max-width:720px;width:92%;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 style="color:${color};font-size:16px">${escapeMsgHtml(title)}</h3>
        <div style="display:flex;gap:8px">
          <button id="celpipCopyBtn" style="padding:6px 12px;border-radius:6px;background:#EEF4FB;color:#0055A4;border:1px solid #3F84C7;cursor:pointer;font-weight:700;font-size:12px">📋 复制</button>
          <button id="celpipCloseBtn" style="padding:6px 12px;border-radius:6px;background:#FFF;color:#1B1F23;border:1px solid #E1E6ED;cursor:pointer;font-size:12px">关闭</button>
        </div>
      </div>
      <textarea readonly id="celpipMsgBody" style="flex:1;min-height:200px;max-height:60vh;padding:12px;border:1px solid #E1E6ED;border-radius:8px;font-family:Menlo,Consolas,monospace;font-size:12px;line-height:1.5;color:#1B1F23;resize:vertical;white-space:pre-wrap;word-break:break-all"></textarea>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('celpipMsgBody').value = String(body || '');
  document.getElementById('celpipCloseBtn').onclick = () => modal.remove();
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.getElementById('celpipCopyBtn').onclick = async () => {
    const ta = document.getElementById('celpipMsgBody');
    ta.select();
    try {
      await navigator.clipboard.writeText(ta.value);
      const b = document.getElementById('celpipCopyBtn');
      b.textContent = '✓ 已复制';
      setTimeout(() => { b.textContent = '📋 复制'; }, 1500);
    } catch { document.execCommand && document.execCommand('copy'); }
  };
}

function escapeMsgHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
