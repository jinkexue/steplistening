// ============================================================
// 统一 TTS 分发：
//   - 支持主 provider + fallback provider 自动重试
//   - 支持多 speaker（多人对话时按角色轮换分配）
//     * volc: settings.volc_tts_speakers = "A|zh_female_vv_uranus_bigtts, B|en_male_tim_uranus_bigtts"
//     * cf:   settings.cf_tts_speakers   = "A|@cf/deepgram/aura-2-en, B|@cf/deepgram/aura-2-en"
//   - 多人对话文本 = 多个说话轮次数组 [{role:"A", text:"..."}, {role:"B", text:"..."}]，
//     每个 role 用对应 speaker 合成，再拼接 mp3 二进制。
//   - 单文本 = 单说话人，取"默认 speaker"或首个映射。
// ============================================================

import { pickModel } from "./volc.js";
import { volcTTSHttp } from "./volcSpeech.js";

async function sha256Hex(text) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 解析 "A|speaker1, B|speaker2" 格式为 { A: "speaker1", B: "speaker2" }
 */
function parseSpeakerMap(str) {
  const map = {};
  if (!str) return map;
  for (const part of String(str).split(/[,\n]/)) {
    const seg = part.trim();
    if (!seg) continue;
    const [role, sp] = seg.split("|").map(x => (x || "").trim());
    if (role && sp) map[role] = sp;
  }
  return map;
}

/**
 * 检测文本是否包含多角色标记，例如 "A: Hello\nB: Hi there" 或 "[Male]: xxx\n[Female]: xxx"
 * 返回 [{role, text}, ...] 或 null
 */
function parseDialogueTurns(text) {
  if (!text) return null;
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const turns = [];
  const roleRe = /^(?:\[?(?<role>[A-Za-z0-9_\-]{1,20})\]?)\s*[:：]\s*(?<utter>.+)$/;
  for (const line of lines) {
    const m = line.match(roleRe);
    if (m && m.groups.role && m.groups.utter) {
      turns.push({ role: m.groups.role.trim(), text: m.groups.utter.trim() });
    } else if (turns.length > 0) {
      // 续行：拼到上一个 turn
      turns[turns.length - 1].text += " " + line;
    }
  }
  if (turns.length >= 2 && new Set(turns.map(t => t.role)).size >= 2) return turns;
  return null;
}

/**
 * 单次合成 - 火山
 */
async function synthVolcOnce(env, settings, text, speaker) {
  const speechKey = env.VOLC_SPEECH_API_KEY || env.VOLC_API_KEY;
  const resourceId = pickModel(settings, "volc_tts") || "seed-tts-2.0";
  const url = (settings.volc_tts_endpoint || "").trim() || undefined;
  return await volcTTSHttp({ apiKey: speechKey, text, resourceId, speaker, url });
}

/**
 * 单次合成 - Cloudflare Workers AI
 *   Aura-2 只有 1 个模型 id：@cf/deepgram/aura-2-en，具体音色通过 speaker 参数指定
 *   兼容旧配置：如果用户把 speaker 塞在模型 id 里（如 @cf/deepgram/aura-2-thalia-en），自动拆分
 */
async function synthCFOnce(env, settings, text, modelOverride) {
  let modelId = modelOverride || pickModel(settings, "cf_tts") || "@cf/deepgram/aura-2-en";
  let speaker = null;
  // 兼容 @cf/deepgram/aura-2-<speaker>-en 这种旧格式
  const m = modelId.match(/^@cf\/deepgram\/aura-2-([a-z]+)-en$/i);
  if (m && m[1] !== "en") {
    speaker = m[1].toLowerCase();
    modelId = "@cf/deepgram/aura-2-en";
  }
  // 也支持 @cf/deepgram/aura-2 + settings.cf_tts_speaker
  if (modelId === "@cf/deepgram/aura-2-en" && !speaker && settings.cf_tts_speaker) {
    speaker = String(settings.cf_tts_speaker).trim();
  }
  const payload = { text };
  if (speaker) payload.speaker = speaker;
  const res = await env.AI.run(modelId, payload);
  if (res instanceof ReadableStream) {
    const reader = res.getReader();
    const parts = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }
    const total = parts.reduce((a, b) => a + b.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  }
  if (res?.audio) {
    const bin = atob(res.audio);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  if (res instanceof ArrayBuffer) return new Uint8Array(res);
  if (res instanceof Uint8Array) return res;
  throw new Error("Cloudflare TTS returned unknown response type");
}

/**
 * 用指定 provider 合成整段（可含多说话人）
 */
async function synthWithProvider(env, settings, text, provider) {
  const turns = parseDialogueTurns(text);
  if (turns) {
    // 多说话人
    const speakerMap = provider === "volc"
      ? parseSpeakerMap(settings.volc_tts_speakers || "")
      : parseSpeakerMap(settings.cf_tts_speakers || "");
    const rolesInOrder = Array.from(new Set(turns.map(t => t.role)));
    // 若配置了 speakerMap 但当前 role 不在里面，按顺序 fallback 分配到 map 里已有的 speaker（循环）
    const mapKeys = Object.keys(speakerMap);
    const chunks = [];
    for (const turn of turns) {
      let sp = speakerMap[turn.role];
      if (!sp && mapKeys.length) {
        const idx = rolesInOrder.indexOf(turn.role);
        sp = speakerMap[mapKeys[idx % mapKeys.length]];
      }
      if (provider === "volc") {
        const speaker = sp || (settings.volc_tts_speaker || "").trim() || "en_female_dacey_uranus_bigtts";
        chunks.push(await synthVolcOnce(env, settings, turn.text, speaker));
      } else {
        // CF：sp 是 speaker 名（如 thalia），直接传 settings 覆盖，或作为 speaker 参数
        const overrideSettings = sp ? { ...settings, cf_tts_speaker: sp } : settings;
        chunks.push(await synthCFOnce(env, overrideSettings, turn.text, null));
      }
    }
    // 拼接 mp3 二进制（多个 mp3 直接拼接大部分播放器可正常连续播放）
    const total = chunks.reduce((a, b) => a + b.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  }
  // 单说话人
  if (provider === "volc") {
    const speaker = (settings.volc_tts_speaker || "").trim() || "en_female_dacey_uranus_bigtts";
    return await synthVolcOnce(env, settings, text, speaker);
  }
  return await synthCFOnce(env, settings, text, null);
}

/**
 * 主入口：读取 tts_provider / tts_fallback_provider，主失败则用备
 * 存 R2 缓存并返回 r2Key
 */
export async function synthesizeTTS(env, settings, text) {
  if (!env.BUCKET) throw new Error("R2 BUCKET missing");
  const primary = (settings.tts_provider || "cloudflare").toLowerCase();
  const fallback = (settings.tts_fallback_provider || "").toLowerCase();

  // 缓存 key 尽量稳定（含 speaker & provider 组合）
  const cacheSig = JSON.stringify({
    p: primary,
    vsp: settings.volc_tts_speaker || "",
    vsps: settings.volc_tts_speakers || "",
    vrid: pickModel(settings, "volc_tts") || "seed-tts-2.0",
    cfm: pickModel(settings, "cf_tts") || "@cf/deepgram/aura-2-en",
    cfsps: settings.cf_tts_speakers || "",
    t: text,
  });
  const hash = await sha256Hex(cacheSig);
  const r2Key = `celpip/tts/${hash}.mp3`;
  if (await env.BUCKET.head(r2Key)) return { r2Key, cached: true, providerUsed: primary };

  let bytes, providerUsed = primary, err1 = null;
  try {
    bytes = await synthWithProvider(env, settings, text, primary);
  } catch (e) {
    err1 = e;
  }
  if (!bytes && fallback && fallback !== primary) {
    try {
      bytes = await synthWithProvider(env, settings, text, fallback);
      providerUsed = fallback;
    } catch (e2) {
      throw new Error(`Both TTS providers failed. primary(${primary}): ${err1?.message} | fallback(${fallback}): ${e2.message}`);
    }
  }
  if (!bytes) {
    throw err1 || new Error("TTS returned no bytes");
  }
  await env.BUCKET.put(r2Key, bytes, { httpMetadata: { contentType: "audio/mpeg" } });
  return { r2Key, cached: false, providerUsed };
}
