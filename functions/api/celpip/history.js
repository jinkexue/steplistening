// ============================================================
// GET /api/celpip/history?user_id=<id>
// 返回该用户历史所有试卷的综合 CLB（用于试卷广场的曲线图）
// [
//   { paper_id, paper_title, updated_at, overall_clb, sections: {listening, reading, writing, speaking} }
// ]
// ============================================================

import { requireUser, json } from "../../lib/auth.js";

function safeParse(s, fb) { try { return JSON.parse(s); } catch { return fb; } }
const NORMALIZE = (v) => {
  if (v == null) return "";
  let s = String(v).trim().replace(/^[\s"'\[\]\(\)]+|[\s"'\[\]\(\)]+$/g, "");
  s = s.replace(/^[A-Da-d]\s*[\.\)、:：]\s*/, (m) => m.trim()[0]);
  if (/^[A-Da-d]$/.test(s)) return s.toUpperCase();
  if (/^\d+$/.test(s)) return s;
  return s.toLowerCase();
};

function estClb(acc) {
  if (acc == null) return null;
  if (acc >= 0.95) return 11;
  if (acc >= 0.90) return 10;
  if (acc >= 0.82) return 9;
  if (acc >= 0.72) return 8;
  if (acc >= 0.60) return 7;
  if (acc >= 0.45) return 6;
  return 5;
}

function isCorrect(answer, options, choice) {
  const a = NORMALIZE(answer);
  for (let i = 0; i < (options || []).length; i++) {
    const label = String.fromCharCode(65 + i);
    const candA = [NORMALIZE(label), NORMALIZE(String(i)), NORMALIZE(options[i])];
    if (!candA.includes(a)) continue;
    const c = NORMALIZE(choice);
    const candC = [NORMALIZE(label), NORMALIZE(String(i)), NORMALIZE(options[i])];
    return candC.includes(c);
  }
  return NORMALIZE(choice) === a;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const guard = await requireUser(request, env);
  if (!guard.ok) return guard.response;

  try {
    // 找出该用户有过 attempt 的所有 paper_id
    const paperIds = await env.DB.prepare(
      "SELECT DISTINCT paper_id FROM celpip_attempts WHERE user_id = ? ORDER BY paper_id"
    ).bind(guard.user.id).all();

    const history = [];
    for (const row of paperIds.results || []) {
      const pid = row.paper_id;
      const paper = await env.DB.prepare("SELECT id, title, updated_at FROM celpip_papers WHERE id = ?").bind(pid).first();
      if (!paper) continue;

      const secRows = await env.DB.prepare(
        "SELECT id, section FROM celpip_paper_sections WHERE paper_id = ?"
      ).bind(pid).all();
      const secMap = {};
      for (const r of secRows.results || []) secMap[r.section] = r.id;

      const attempts = await env.DB.prepare(
        "SELECT * FROM celpip_attempts WHERE user_id = ? AND paper_id = ?"
      ).bind(guard.user.id, pid).all();

      const byS = {};
      for (const a of attempts.results || []) (byS[a.section] = byS[a.section] || []).push(a);

      const secClb = {};
      let sum = 0, cnt = 0, latest = 0;

      for (const secName of ["listening", "reading"]) {
        const table = secName === "listening" ? "celpip_listening_items" : "celpip_reading_items";
        if (!secMap[secName]) continue;
        const items = (await env.DB.prepare(`SELECT * FROM ${table} WHERE section_id = ?`).bind(secMap[secName]).all()).results || [];
        if (!items.length) continue;
        let correct = 0, totalQ = 0;
        for (const it of items) {
          if (secName === "listening") {
            const partQs = safeParse(it.questions_json, null);
            if (partQs && Array.isArray(partQs)) totalQ += partQs.length;
            else totalQ += 1;
          } else {
            totalQ += (safeParse(it.questions, []).length || 0);
          }
        }
        for (const at of byS[secName] || []) {
          const item = items.find(x => x.id === at.item_id); if (!item) continue;
          const ans = safeParse(at.answer_json, {});
          if (secName === "listening") {
            const partQs = safeParse(item.questions_json, null);
            if (partQs && Array.isArray(partQs) && partQs.length > 0) {
              const userAnswers = ans.answers || {};
              for (let i = 0; i < partQs.length; i++) {
                const q = partQs[i] || {};
                const uAns = userAnswers[i];
                if (uAns == null || uAns === "") continue;
                if (isCorrect(q.answer, q.options || [], uAns)) correct += 1;
              }
            } else {
              const opts = safeParse(item.options, []);
              if (isCorrect(item.answer, opts, ans.choice)) correct += 1;
            }
          } else {
            const qs = safeParse(item.questions, []);
            const userAnswers = ans.answers || {};
            for (let i = 0; i < qs.length; i++) {
              const q = qs[i] || {};
              const uAns = userAnswers[i];
              if (uAns == null || uAns === "") continue;
              if (isCorrect(q.answer, (q.options || []), uAns)) correct += 1;
            }
          }
          const t = Date.parse(at.updated_at || 0); if (t > latest) latest = t;
        }
        const acc = totalQ > 0 ? correct / totalQ : null;
        const clb = estClb(acc);
        if (clb != null) { sum += clb; cnt += 1; secClb[secName] = clb; }
      }

      for (const secName of ["writing", "speaking"]) {
        const secAttempts = byS[secName] || [];
        const clbs = [];
        for (const at of secAttempts) {
          const sc = safeParse(at.score_json, {});
          if (typeof sc.overall_clb === "number") clbs.push(sc.overall_clb);
          const t = Date.parse(at.updated_at || 0); if (t > latest) latest = t;
        }
        if (clbs.length) {
          const avg = clbs.reduce((a, b) => a + b, 0) / clbs.length;
          sum += avg; cnt += 1; secClb[secName] = Number(avg.toFixed(1));
        }
      }

      const overall = cnt > 0 ? Math.round(sum / cnt) : null;
      history.push({
        paper_id: pid,
        paper_title: paper.title,
        updated_at: latest ? new Date(latest).toISOString() : paper.updated_at,
        overall_clb: overall,
        sections: secClb,
      });
    }

    // 按时间排序
    history.sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at));
    return json({ history });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
