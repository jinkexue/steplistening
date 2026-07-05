// ============================================================
// 火山方舟 Agent Plan 语音接口封装（TTS via HTTP Chunked）
// 参考：https://www.volcengine.com/docs/82379/2516286
//
// 关键差异（区别于方舟 OpenAI 兼容接口）：
// - 域名：openspeech.bytedance.com（不是 ark.cn-beijing.volces.com）
// - Auth：X-Api-Key（不是 Authorization: Bearer）
// - 必填：X-Api-Resource-Id: seed-tts-2.0
// - 响应：line-delimited JSON chunk stream，每行 {code, data(base64), ...}
//   - code=0 且 data 存在 → 该 chunk 是音频片段（base64 mp3）
//   - code=20000000 → 会话结束
//   - code>0 → 错误
// - API Key 必须是 Agent Plan 专属 Key（普通方舟 Key 会 401）
// ============================================================

const VOLC_TTS_HTTP_URL = "https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional";

/**
 * 通过火山方舟 HTTP TTS 合成一段音频，返回 mp3 二进制
 * @param {object} opts
 * @param {string} opts.apiKey       Agent Plan 专属 API Key
 * @param {string} opts.text         待合成文本
 * @param {string} [opts.resourceId] 默认 seed-tts-2.0
 * @param {string} [opts.speaker]    默认英文女声，可换 zh_female_vv_uranus_bigtts 等
 * @param {string} [opts.format]     mp3 / wav，默认 mp3
 * @param {number} [opts.sampleRate] 默认 24000
 * @returns {Promise<Uint8Array>}
 */
export async function volcTTSHttp({
  apiKey,
  text,
  resourceId = "seed-tts-2.0",
  speaker = "en_female_amanda_uranus_bigtts",
  format = "mp3",
  sampleRate = 24000,
  url = VOLC_TTS_HTTP_URL,
}) {
  if (!apiKey) throw new Error("volc speech API key missing (need Agent Plan key)");
  if (!text || !text.trim()) throw new Error("tts text empty");

  const body = {
    req_params: {
      text,
      speaker,
      audio_params: { format, sample_rate: sampleRate },
    },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "X-Api-Key": apiKey,
      "X-Api-Resource-Id": resourceId,
      "Content-Type": "application/json",
      "Connection": "keep-alive",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`volc TTS HTTP ${resp.status}: ${txt.slice(0, 300)}`);
  }
  if (!resp.body) throw new Error("volc TTS: no response body");

  // 按行解析 chunked JSON
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let buf = "";
  let finished = false;

  while (!finished) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let data;
      try { data = JSON.parse(line); }
      catch {
        // 有的行可能不是 JSON，跳过
        continue;
      }
      const code = data.code == null ? 0 : Number(data.code);
      if (code === 0 && data.data) {
        // base64 音频片段
        try { chunks.push(base64ToBytes(data.data)); }
        catch (e) { throw new Error("volc TTS base64 decode failed: " + e.message); }
      } else if (code === 20000000) {
        finished = true;
        break;
      } else if (code > 0) {
        throw new Error(`volc TTS session error code=${code} message=${data.message || JSON.stringify(data).slice(0, 200)}`);
      }
    }
  }

  const total = chunks.reduce((a, b) => a + b.length, 0);
  if (total === 0) throw new Error("volc TTS: no audio data received");
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
