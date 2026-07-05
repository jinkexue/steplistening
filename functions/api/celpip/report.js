// ============================================================
// GET /api/celpip/report?paper_id=<id>&user_id=<id>
// 返回该用户在指定试卷上的四板块综合成绩单
// {
//   paper: {...},
//   sections: {
//     listening: { total, done, correct, wrong, overtime, accuracy, estimated_clb },
//     reading:   { total, done, correct, wrong, overtime, accuracy, estimated_clb },
//     writing:   { total, done, avg_clb, dimensions },
//     speaking:  { total, done, avg_clb, dimensions },
//   },
//   overall_clb: number|null,
//   time_stats: { listening:{used,suggested,over}, reading:{...} }
// }
// ============================================================

import { requireUser, json } from "../../lib/auth.js";

const NORMALIZE = (v) => {
  if (v == null) return "";
  let s = String(v).trim().replace(/^[\s"'\[\]\(\)]+|[\s"'\[\]\(\)]+$/g, "");
  s = s.replace(/^[A-Da-d]\s*[\.\)、:：]\s*/, (m) => m.trim()[0]);
  if (/^[A-Da-d]$/.test(s)) return s.toUpperCase();
  if (/^\d+$/.test(s)) return s;
  return s.toLowerCase();
};

function safeParse(s, fb) { try { return JSON.parse(s); } catch { return fb; } }

// 简单从 accuracy 估算 CLB（保守映射）
function estimateClbFromAccuracy(acc) {
  if (acc == null) return null;
  if (acc >= 0.95) return 11;
  if (acc >= 0.90) return 10;
  if (acc >= 0.82) return 9;
  if (acc >= 0.72) return 8;
  if (acc >= 0.60) return 7;
  if (acc >= 0.45) return 6;
  return 5;
}

function isListeningCorrect(answer, options, choice) {
  const a = NORMALIZE(answer);
  for (let i = 0; i < (options || []).length; i++) {
    const label = String.fromCharCode(65 + i);
    const candA = [NORMALIZE(label), NORMALIZE(String(i)), NORMALIZE(options[i])];
    if (!candA.includes(a)) continue;
    // 找到答案锁定的索引，比较用户选择
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
    const url = new URL(request.url);
    const paperId = Number(url.searchParams.get("paper_id"));
    if (!paperId) return json({ error: "paper_id required" }, 400);

    const paper = await env.DB.prepare(
      "SELECT * FROM celpip_papers WHERE id = ?"
    ).bind(paperId).first();
    if (!paper) return json({ error: "paper not found" }, 404);

    // 拉取所有 section id
    const secRows = await env.DB.prepare(
      "SELECT id, section FROM celpip_paper_sections WHERE paper_id = ?"
    ).bind(paperId).all();
    const secMap = {};
    for (const r of secRows.results || []) secMap[r.section] = r.id;

    // 拉取该用户所有 attempts
    const attempts = await env.DB.prepare(
      "SELECT * FROM celpip_attempts WHERE user_id = ? AND paper_id = ?"
    ).bind(guard.user.id, paperId).all();

    const attemptsBySection = {};
    for (const a of attempts.results || []) {
      (attemptsBySection[a.section] = attemptsBySection[a.section] || []).push(a);
    }

    const sections = {};
    let sumClb = 0, sumClbCount = 0;
    const timeStats = {};

    // Listening / Reading：对错 + 超时
    for (const secName of ["listening", "reading"]) {
      const table = secName === "listening" ? "celpip_listening_items" : "celpip_reading_items";
      const items = secMap[secName]
        ? await env.DB.prepare(`SELECT * FROM ${table} WHERE section_id = ?`).bind(secMap[secName]).all()
        : { results: [] };
      const list = items.results || [];
      const secAttempts = attemptsBySection[secName] || [];
      const done = secAttempts.length;
      let correct = 0, wrong = 0, overtime = 0;
      let usedSum = 0, suggestSum = 0;

      for (const at of secAttempts) {
        const ans = safeParse(at.answer_json, {});
        if (ans.overtime) overtime += 1;
        if (typeof ans.used_seconds === "number") usedSum += ans.used_seconds;
        if (typeof ans.suggested_seconds === "number") suggestSum += ans.suggested_seconds;

        const item = list.find((x) => x.id === at.item_id);
        if (!item) continue;

        if (secName === "listening") {
          // 新版：questions_json 里是数组；旧版：单题 options/answer
          const partQs = safeParse(item.questions_json, null);
          if (partQs && Array.isArray(partQs) && partQs.length > 0) {
            const userAnswers = ans.answers || {};
            for (let i = 0; i < partQs.length; i++) {
              const q = partQs[i] || {};
              const uAns = userAnswers[i];
              if (uAns == null || uAns === "") { wrong += 1; continue; }
              if (isListeningCorrect(q.answer, q.options || [], uAns)) correct += 1;
              else wrong += 1;
            }
          } else {
            const opts = safeParse(item.options, []);
            if (isListeningCorrect(item.answer, opts, ans.choice)) correct += 1;
            else wrong += 1;
          }
        } else {
          const qs = safeParse(item.questions, []);
          const userAnswers = ans.answers || {};
          for (let i = 0; i < qs.length; i++) {
            const q = qs[i] || {};
            const opts = q.options || [];
            const uAns = userAnswers[i];
            if (uAns == null || uAns === "") { wrong += 1; continue; }
            if (isListeningCorrect(q.answer, opts, uAns)) correct += 1;
            else wrong += 1;
          }
        }
      }

      // 总题数：Listening 新版按 questions_json 累加；Reading 累加 questions
      const totalQuestions = secName === "listening"
        ? list.reduce((a, it) => {
            const partQs = safeParse(it.questions_json, null);
            if (partQs && Array.isArray(partQs)) return a + partQs.length;
            return a + 1;
          }, 0)
        : list.reduce((a, it) => a + (safeParse(it.questions, []).length || 0), 0);

      const accuracy = totalQuestions > 0 ? correct / totalQuestions : null;
      const estimated_clb = accuracy != null ? estimateClbFromAccuracy(accuracy) : null;
      if (estimated_clb != null) { sumClb += estimated_clb; sumClbCount += 1; }

      sections[secName] = {
        total: list.length,
        total_questions: totalQuestions,
        done,
        correct, wrong, overtime,
        accuracy: accuracy != null ? Number(accuracy.toFixed(3)) : null,
        estimated_clb,
      };
      timeStats[secName] = { used: usedSum, suggested: suggestSum, over: overtime };
    }

    // Writing / Speaking：读 score_json
    for (const secName of ["writing", "speaking"]) {
      const table = secName === "writing" ? "celpip_writing_items" : "celpip_speaking_items";
      const items = secMap[secName]
        ? await env.DB.prepare(`SELECT id, task FROM ${table} WHERE section_id = ?`).bind(secMap[secName]).all()
        : { results: [] };
      const list = items.results || [];
      const secAttempts = attemptsBySection[secName] || [];
      const done = secAttempts.length;

      const clbs = [];
      const dims = { fluency: [], grammar: [], vocabulary: [], content_coherence: [], readability: [], task_fulfillment: [] };
      for (const at of secAttempts) {
        const sc = safeParse(at.score_json, {});
        if (typeof sc.overall_clb === "number") clbs.push(sc.overall_clb);
        for (const k of Object.keys(dims)) {
          if (typeof sc[k] === "number") dims[k].push(sc[k]);
        }
      }
      const avg = arr => arr.length ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)) : null;
      const avg_clb = avg(clbs);
      if (avg_clb != null) { sumClb += avg_clb; sumClbCount += 1; }

      const dimAvg = {};
      for (const k of Object.keys(dims)) if (dims[k].length) dimAvg[k] = avg(dims[k]);

      sections[secName] = {
        total: list.length,
        done,
        avg_clb,
        dimensions: dimAvg,
      };
    }

    const overall_clb = sumClbCount > 0 ? Math.round(sumClb / sumClbCount) : null;

    return json({ paper, sections, overall_clb, time_stats: timeStats });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
