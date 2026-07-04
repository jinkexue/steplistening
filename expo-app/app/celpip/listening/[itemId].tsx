import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, ScrollView, ActivityIndicator, Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import CelpipTheme from '@/constants/CelpipTheme';
import { API_BASE, API_ORIGIN } from '@/config/api';

type Item = {
  id: number;
  part: number;
  audio_key: string | null;
  image_key: string | null;
  transcript: string;
  question: string;
  options: string;    // JSON stringified
  answer: string;
  order_index: number;
};

type Attempt = {
  id: number;
  item_id: number;
  answer_json: string | null;
  score_json: string | null;
  status: string;
};

const RECORDING_TIME_BY_PART: Record<number, number> = {
  1: 45, 2: 60, 3: 60, 4: 45, 5: 60, 6: 60,
};

function getUserId(): number | null {
  if (Platform.OS !== 'web') return null;
  const v = window.localStorage?.getItem('user_id');
  return v ? Number(v) : null;
}

function assetUrl(key: string) {
  return `${API_BASE}/celpip/asset?key=${encodeURIComponent(key)}`;
}

function safeParse<T = any>(s?: string | null, fallback?: T): T {
  if (!s) return fallback as T;
  try { return JSON.parse(s); } catch { return fallback as T; }
}

export default function ListeningPractice() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const search = useLocalSearchParams<{ paper_id?: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [audioPlayed, setAudioPlayed] = useState(false);
  const [showQuestion, setShowQuestion] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number>(60);
  const [paraphrase, setParaphrase] = useState<any>(null);
  const [paraphrasing, setParaphrasing] = useState(false);

  const timerRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const paperId = String(search?.paper_id || '');
  const activeId = Number(itemId);

  const activeIndex = useMemo(() => items.findIndex(i => i.id === activeId), [items, activeId]);
  const active = activeIndex >= 0 ? items[activeIndex] : null;
  const options = useMemo(() => safeParse<string[]>(active?.options, []), [active]);
  const savedAttempt = useMemo(
    () => attempts.find(a => a.item_id === activeId) || null,
    [attempts, activeId]
  );

  const load = useCallback(async () => {
    if (!paperId) { setError('缺少 paper_id 参数'); setLoading(false); return; }
    const uid = getUserId();
    if (!uid) { setError('请先登录'); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_BASE}/celpip/section?paper_id=${paperId}&section=listening&user_id=${uid}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setItems(data.items || []);
      setAttempts(data.attempts || []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [paperId]);

  useEffect(() => { load(); }, [load]);

  // 切题时重置状态
  useEffect(() => {
    setAudioPlayed(false);
    setShowQuestion(false);
    setSelected(null);
    setSubmitted(false);
    setParaphrase(null);
    if (active) setTimeLeft(RECORDING_TIME_BY_PART[active.part] || 60);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    // 若已有作答，直接展示结果
    if (savedAttempt?.answer_json) {
      const parsed = safeParse<{ choice?: string }>(savedAttempt.answer_json, {});
      if (parsed.choice) {
        setSelected(parsed.choice);
        setSubmitted(true);
        setShowQuestion(true);
        setAudioPlayed(true);
      }
    }
  }, [activeId, active?.part, savedAttempt?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const startCountdown = () => {
    if (timerRef.current) return;
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(timerRef.current); timerRef.current = null;
          // 时间到自动提交（未选也算作 null）
          submitAnswer(null, /*auto*/true);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
  };

  const onAudioEnded = () => {
    setAudioPlayed(true);
    setShowQuestion(true);
    startCountdown();
  };

  const playAudio = () => {
    if (audioRef.current) {
      audioRef.current.play().catch(() => {});
    }
  };

  const submitAnswer = async (choice: string | null, auto = false) => {
    if (submitted) return;
    setSubmitted(true);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const uid = getUserId();
    if (!uid || !active) return;
    try {
      await fetch(`${API_BASE}/celpip/attempts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: uid,
          paper_id: Number(paperId),
          section: 'listening',
          item_id: active.id,
          answer_json: JSON.stringify({ choice, auto }),
          status: 'submitted',
        }),
      });
    } catch (e: any) {
      // 静默失败，不阻断答题
      console.warn('save attempt failed:', e.message);
    }
  };

  const requestParaphrase = async () => {
    const uid = getUserId();
    if (!uid || !active) return;
    setParaphrasing(true);
    try {
      const res = await fetch(`${API_BASE}/celpip/listening/paraphrase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: uid,
          item_id: active.id,
          wrong_option: selected,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setParaphrase(data.result);
    } catch (e: any) {
      Alert.alert('解析失败', e.message);
    } finally {
      setParaphrasing(false);
    }
  };

  const goToItem = (id: number) => {
    router.replace(`/celpip/listening/${id}?paper_id=${paperId}` as any);
  };

  if (loading) {
    return <SafeAreaView style={styles.container}><ActivityIndicator color={CelpipTheme.primary} style={{ marginTop: 24 }} /></SafeAreaView>;
  }
  if (error) {
    return <SafeAreaView style={styles.container}><Text style={styles.error}>加载失败：{error}</Text></SafeAreaView>;
  }
  if (!active) {
    return <SafeAreaView style={styles.container}><Text style={styles.error}>找不到该题目</Text></SafeAreaView>;
  }

  const isCorrect = submitted && selected != null && String(selected) === String(active.answer);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* 顶部：Part + 题号导航 */}
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Listening · Part {active.part}</Text>
          <View style={styles.navRow}>
            {items.map((it, idx) => (
              <TouchableOpacity
                key={it.id}
                style={[
                  styles.navChip,
                  it.id === active.id && styles.navChipActive,
                  attempts.some(a => a.item_id === it.id) && styles.navChipDone,
                ]}
                onPress={() => goToItem(it.id)}
              >
                <Text style={[styles.navChipText, it.id === active.id && styles.navChipTextActive]}>
                  {idx + 1}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* 音频区 */}
        <View style={styles.mediaBox}>
          {active.audio_key ? (
            Platform.OS === 'web' ? (
              // @ts-ignore
              <audio
                ref={(r: any) => { audioRef.current = r; }}
                src={assetUrl(active.audio_key)}
                onEnded={onAudioEnded}
                controls={!audioPlayed}
                controlsList={audioPlayed ? 'nodownload noplaybackrate' : 'nodownload'}
                style={{ width: '100%' }}
              />
            ) : (
              <Text style={styles.hint}>移动端播放器将在后续版本支持。请使用 Web 端答题。</Text>
            )
          ) : (
            <Text style={styles.hint}>本题尚无音频（TTS 生成失败？请管理员重试一键生成）。</Text>
          )}
          <Text style={styles.hint}>
            {audioPlayed ? '音频已播完，无法重听。' : '注意：音频仅播放一次，播完后才会显示题目。'}
          </Text>
        </View>

        {/* 图片（部分 Part） */}
        {active.image_key && (
          // @ts-ignore
          <img src={assetUrl(active.image_key)} style={{ maxWidth: 480, borderRadius: 12, marginBottom: 16 }} />
        )}

        {/* 倒计时 */}
        {showQuestion && !submitted && (
          <View style={styles.timerBox}>
            <Text style={[styles.timer, timeLeft <= 10 && { color: CelpipTheme.danger }]}>
              ⏱ 剩余 {timeLeft}s
            </Text>
          </View>
        )}

        {/* 题目 */}
        {showQuestion && (
          <View style={styles.questionBox}>
            <Text style={styles.questionText}>{active.question}</Text>
            <View style={{ gap: 8, marginTop: 12 }}>
              {options.map((opt, i) => {
                const label = String.fromCharCode(65 + i); // A/B/C/D
                const isSelected = selected === label || selected === String(i) || selected === opt;
                const isAnswer = submitted && (
                  String(active.answer) === label ||
                  String(active.answer) === String(i) ||
                  String(active.answer) === opt
                );
                let cardStyle = [styles.optionCard];
                if (isSelected) cardStyle.push(styles.optionCardSelected as any);
                if (submitted && isAnswer) cardStyle.push(styles.optionCardCorrect as any);
                if (submitted && isSelected && !isAnswer) cardStyle.push(styles.optionCardWrong as any);
                return (
                  <TouchableOpacity
                    key={i}
                    style={cardStyle}
                    disabled={submitted}
                    onPress={() => setSelected(label)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.optionLabel}>{label}</Text>
                    <Text style={styles.optionText}>{opt}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {!submitted && (
              <TouchableOpacity
                style={[styles.submitBtn, !selected && { opacity: 0.5 }]}
                disabled={!selected}
                onPress={() => submitAnswer(selected)}
              >
                <Text style={styles.submitBtnText}>提交答案</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* 结果 & 解析 */}
        {submitted && (
          <View style={styles.resultBox}>
            <Text style={[styles.resultTitle, { color: isCorrect ? CelpipTheme.success : CelpipTheme.danger }]}>
              {isCorrect ? '✓ 答对了' : '✗ 答错了'}
            </Text>
            <Text style={styles.resultCorrect}>正确答案：{active.answer}</Text>

            {active.transcript ? (
              <View style={styles.transcriptBox}>
                <Text style={styles.transcriptTitle}>原文 Transcript</Text>
                <Text style={styles.transcriptText}>{active.transcript}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={styles.aiBtn}
              onPress={requestParaphrase}
              disabled={paraphrasing}
            >
              <Text style={styles.aiBtnText}>
                {paraphrasing ? 'AI 解析中…' : '🤖 AI 同义替换 & 错项拆解'}
              </Text>
            </TouchableOpacity>

            {paraphrase && (
              <View style={styles.paraphraseBox}>
                {!!paraphrase.paraphrase && (
                  <>
                    <Text style={styles.paraphraseHeader}>Paraphrase</Text>
                    <Text style={styles.paraphraseText}>{paraphrase.paraphrase}</Text>
                  </>
                )}
                {!!paraphrase.why_wrong && (
                  <>
                    <Text style={styles.paraphraseHeader}>为什么你的选项不对</Text>
                    <Text style={styles.paraphraseText}>{Array.isArray(paraphrase.why_wrong) ? paraphrase.why_wrong.join('\n• ') : paraphrase.why_wrong}</Text>
                  </>
                )}
                {!!paraphrase.why_right && (
                  <>
                    <Text style={styles.paraphraseHeader}>为什么正确答案对</Text>
                    <Text style={styles.paraphraseText}>{paraphrase.why_right}</Text>
                  </>
                )}
                {Array.isArray(paraphrase.key_vocab) && paraphrase.key_vocab.length > 0 && (
                  <>
                    <Text style={styles.paraphraseHeader}>关键词</Text>
                    {paraphrase.key_vocab.map((v: any, i: number) => (
                      <Text key={i} style={styles.paraphraseText}>
                        • <Text style={{ fontWeight: '700' }}>{v.word}</Text> — {v.meaning_zh}
                        {v.example ? `\n   e.g. ${v.example}` : ''}
                      </Text>
                    ))}
                  </>
                )}
              </View>
            )}
          </View>
        )}

        {/* 下一题 */}
        <View style={{ height: 24 }} />
        <View style={styles.footerNav}>
          {activeIndex > 0 && (
            <TouchableOpacity style={styles.navBtn} onPress={() => goToItem(items[activeIndex - 1].id)}>
              <Text style={styles.navBtnText}>← 上一题</Text>
            </TouchableOpacity>
          )}
          {activeIndex < items.length - 1 && (
            <TouchableOpacity
              style={[styles.navBtn, styles.navBtnPrimary]}
              onPress={() => goToItem(items[activeIndex + 1].id)}
            >
              <Text style={[styles.navBtnText, { color: '#FFF' }]}>下一题 →</Text>
            </TouchableOpacity>
          )}
          {activeIndex === items.length - 1 && submitted && (
            <TouchableOpacity
              style={[styles.navBtn, styles.navBtnPrimary]}
              onPress={() => router.replace(`/celpip/paper/${paperId}` as any)}
            >
              <Text style={[styles.navBtnText, { color: '#FFF' }]}>返回试卷</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: CelpipTheme.background },
  content: { padding: 24, maxWidth: 900, width: '100%', alignSelf: 'center' },
  headerRow: { marginBottom: 16, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 16 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: CelpipTheme.primary },
  navRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  navChip: {
    width: 32, height: 32, borderRadius: 6,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: CelpipTheme.border,
    backgroundColor: '#FFF',
  },
  navChipActive: { backgroundColor: CelpipTheme.primary, borderColor: CelpipTheme.primary },
  navChipDone: { backgroundColor: '#E7F5EC', borderColor: CelpipTheme.success },
  navChipText: { fontSize: 12, fontWeight: '700', color: CelpipTheme.textMuted },
  navChipTextActive: { color: '#FFF' },
  mediaBox: {
    padding: 16, borderRadius: 12, backgroundColor: CelpipTheme.surface,
    borderWidth: 1, borderColor: CelpipTheme.border, marginBottom: 12,
  },
  hint: { color: CelpipTheme.textMuted, fontSize: 12, marginTop: 8 },
  timerBox: { marginBottom: 12 },
  timer: { fontSize: 18, fontWeight: '700', color: CelpipTheme.text },
  questionBox: {
    padding: 16, borderRadius: 12, backgroundColor: CelpipTheme.surfaceElevated,
    borderWidth: 1, borderColor: CelpipTheme.border, marginBottom: 16,
  },
  questionText: { fontSize: 16, color: CelpipTheme.text, fontWeight: '600' },
  optionCard: {
    flexDirection: 'row', gap: 12, alignItems: 'center',
    padding: 12, borderWidth: 1, borderColor: CelpipTheme.border, borderRadius: 8,
    backgroundColor: '#FFF',
  },
  optionCardSelected: { borderColor: CelpipTheme.primary, backgroundColor: '#EEF4FB' },
  optionCardCorrect: { borderColor: CelpipTheme.success, backgroundColor: '#E7F5EC' },
  optionCardWrong: { borderColor: CelpipTheme.danger, backgroundColor: '#FBEEEE' },
  optionLabel: {
    width: 28, height: 28, textAlign: 'center', lineHeight: 28, borderRadius: 14,
    backgroundColor: CelpipTheme.surface, fontWeight: '700', color: CelpipTheme.primary,
  },
  optionText: { flex: 1, color: CelpipTheme.text, fontSize: 14 },
  submitBtn: {
    marginTop: 16, alignSelf: 'flex-end',
    paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8, backgroundColor: CelpipTheme.primary,
  },
  submitBtnText: { color: '#FFF', fontWeight: '700' },
  resultBox: {
    padding: 16, borderRadius: 12, backgroundColor: CelpipTheme.surface,
    borderWidth: 1, borderColor: CelpipTheme.border, gap: 8,
  },
  resultTitle: { fontSize: 18, fontWeight: '700' },
  resultCorrect: { color: CelpipTheme.textMuted },
  transcriptBox: { marginTop: 8 },
  transcriptTitle: { fontSize: 13, fontWeight: '700', color: CelpipTheme.text, marginBottom: 4 },
  transcriptText: { fontSize: 13, color: CelpipTheme.textMuted, lineHeight: 20 },
  aiBtn: {
    marginTop: 8, alignSelf: 'flex-start',
    paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8,
    backgroundColor: '#EEF4FB', borderWidth: 1, borderColor: CelpipTheme.primaryLight,
  },
  aiBtnText: { color: CelpipTheme.primary, fontWeight: '700' },
  paraphraseBox: {
    marginTop: 12, padding: 12, borderRadius: 8, backgroundColor: '#FFF',
    borderWidth: 1, borderColor: CelpipTheme.border, gap: 6,
  },
  paraphraseHeader: { fontSize: 13, fontWeight: '700', color: CelpipTheme.primary, marginTop: 6 },
  paraphraseText: { fontSize: 13, color: CelpipTheme.text, lineHeight: 20 },
  footerNav: { flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  navBtn: {
    paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8,
    borderWidth: 1, borderColor: CelpipTheme.border, backgroundColor: '#FFF',
  },
  navBtnPrimary: { backgroundColor: CelpipTheme.primary, borderColor: CelpipTheme.primary },
  navBtnText: { color: CelpipTheme.text, fontWeight: '700' },
  error: { color: CelpipTheme.danger, padding: 24 },
});
