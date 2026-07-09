// CELPIP 各 Part / Task 所需资源规范
// 用于：
//   - 后端 autofix_assets：判断某道题应有什么资源、缺什么
//   - 前端字段动态显示：按 part/task 过滤 FIELD_DEFS

/**
 * 判断听力某个 Part 应有的资源
 * @returns {
 *   audio: boolean,               // 是否需要整段音频
 *   segmentedAudio: number,       // 需要几段音频（0 = 不分段，只 1 段整体音频）
 *   image: 'none' | 'optional_single' | 'required_single' | 'multi',
 *   maxImages: number,            // 多图时最多几张
 * }
 */
export function listeningPartSpec(part) {
  const p = Number(part);
  if (p === 1) return { audio: true, segmentedAudio: 3, image: "none",             maxImages: 0 };
  if (p === 2) return { audio: true, segmentedAudio: 5, image: "none",             maxImages: 0 };
  if (p === 3) return { audio: true, segmentedAudio: 0, image: "optional_single",  maxImages: 1 };
  if (p === 4) return { audio: true, segmentedAudio: 0, image: "optional_single",  maxImages: 1 };
  if (p === 5) return { audio: true, segmentedAudio: 0, image: "multi",            maxImages: 2 };
  if (p === 6) return { audio: true, segmentedAudio: 0, image: "none",             maxImages: 0 };
  return { audio: false, segmentedAudio: 0, image: "none", maxImages: 0 };
}

/**
 * 判断口语某个 Task 应有的资源
 * @returns {
 *   image: 'none' | 'required_single' | 'optional_single',
 * }
 */
export function speakingTaskSpec(task) {
  const t = Number(task);
  if (t === 3) return { image: "required_single" }; // 描述图片
  if (t === 4) return { image: "required_single" }; // 建议图片
  if (t === 5) return { image: "optional_single" }; // 比较（选一图，简化只支持 1 张）
  return { image: "none" };
}

/**
 * 扫描听力 item 缺失的资源
 * @param row  DB row（celpip_listening_items）
 * @returns {
 *   missing: string[],        // 缺失说明列表
 *   actions: [{ kind, ... }]  // 需要调用 regenerate_asset 的动作
 * }
 */
export function scanListeningMissing(row) {
  const spec = listeningPartSpec(row.part);
  const missing = [];
  const actions = [];
  const segments = safeParse(row.segments_json, []);
  const imagePrompts = safeParse(row.image_prompts_json, []);
  const imageKeys = safeParse(row.image_keys_json, []);

  if (spec.audio) {
    if (spec.segmentedAudio > 0) {
      // 分段音频：检查每段
      for (let i = 0; i < spec.segmentedAudio; i++) {
        const seg = segments[i];
        if (!seg || !seg.audio_key) {
          if (seg && seg.transcript) {
            missing.push(`segment ${i} audio missing`);
            actions.push({ kind: "seg_audio", seg_index: i });
          }
        }
      }
    } else {
      // 单段音频：检查 audio_key
      if (!row.audio_key) {
        const hasText = (row.transcript || segments[0]?.transcript || "").trim();
        if (hasText) {
          missing.push("main audio missing");
          actions.push({ kind: "audio" });
        }
      }
    }
  }

  if (spec.image === "multi") {
    // Part 5：检查每张图
    const need = Math.min(spec.maxImages, imagePrompts.length || spec.maxImages);
    for (let i = 0; i < need; i++) {
      if (!imageKeys[i]) {
        missing.push(`image ${i} missing`);
        actions.push({ kind: "image_keys", img_index: i });
      }
    }
  } else if (spec.image === "required_single" || spec.image === "optional_single") {
    if (!row.image_key) {
      // 有 prompt 才补生（optional 就是没 prompt 时跳过）
      if (row.image_prompt || imagePrompts[0]) {
        missing.push("single image missing");
        actions.push({ kind: "image" });
      } else if (spec.image === "required_single") {
        missing.push("single image missing (and no image_prompt — will auto-derive from transcript)");
        actions.push({ kind: "image", auto_prompt: true });
      }
    }
  }

  return { missing, actions };
}

/**
 * 扫描口语 item 缺失的资源
 */
export function scanSpeakingMissing(row) {
  const spec = speakingTaskSpec(row.task);
  const missing = [];
  const actions = [];
  if (spec.image === "required_single" || spec.image === "optional_single") {
    if (!row.image_key) {
      if (row.image_prompt) {
        missing.push("image missing");
        actions.push({ kind: "image" });
      } else if (spec.image === "required_single") {
        missing.push("image missing (and no image_prompt — will auto-derive)");
        actions.push({ kind: "image", auto_prompt: true });
      }
    }
  }
  return { missing, actions };
}

function safeParse(s, def) {
  if (!s) return def;
  if (typeof s !== "string") return s;
  try { return JSON.parse(s); } catch { return def; }
}
