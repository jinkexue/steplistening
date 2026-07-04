import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, ActivityIndicator, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import CelpipTheme from '@/constants/CelpipTheme';
import { API_BASE } from '@/config/api';

type SectionKey = 'listening' | 'reading' | 'writing' | 'speaking';

const SECTIONS: Array<{ key: SectionKey; label: string; desc: string; icon: string }> = [
  { key: 'listening', label: '听力 Listening', desc: '6 个 Part · 加拿大口音 · 每题独立倒计时', icon: '🎧' },
  { key: 'speaking',  label: '口语 Speaking',  desc: '8 个 Task · 含图文 · Prep + Recording',   icon: '🗣️' },
  { key: 'reading',   label: '阅读 Reading',   desc: '4 个 Part · 左右分栏 · Drop-down 题',    icon: '📖' },
  { key: 'writing',   label: '写作 Writing',   desc: '2 个 Task · CLB 四维评分 · AI 范文对比', icon: '✍️' },
];

function getUserId(): number | null {
  if (Platform.OS !== 'web') return null;
  const v = window.localStorage?.getItem('user_id');
  return v ? Number(v) : null;
}

export default function PaperDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paper, setPaper] = useState<any>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [firstIds, setFirstIds] = useState<Record<string, number | null>>({});
  const [progress, setProgress] = useState<Record<string, number>>({}); // 各 section 已答题数

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/celpip/papers?id=${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPaper(data.paper);
      setCounts(data.counts || {});

      // 并发拉取每个 section 的题目 & 进度（只用来定位第一题 id + 已完成计数）
      const uid = getUserId();
      if (uid) {
        const results = await Promise.all(
          (['listening', 'reading', 'writing', 'speaking'] as SectionKey[]).map(async (s) => {
            try {
              const r = await fetch(`${API_BASE}/celpip/section?paper_id=${id}&section=${s}&user_id=${uid}`);
              const d = await r.json();
              return {
                section: s,
                firstId: (d.items && d.items[0]) ? d.items[0].id : null,
                done: (d.attempts || []).length,
              };
            } catch { return { section: s, firstId: null, done: 0 }; }
          })
        );
        const idMap: Record<string, number | null> = {};
        const progMap: Record<string, number> = {};
        for (const r of results) {
          idMap[r.section] = r.firstId;
          progMap[r.section] = r.done;
        }
        setFirstIds(idMap);
        setProgress(progMap);
      }
    } catch (e: any) {
      setError(e.message || 'load failed');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const enterSection = (s: SectionKey) => {
    const first = firstIds[s];
    if (!first) {
      Alert.alert('该板块尚无题目', '请让管理员在后台点击「一键生成」补充题目');
      return;
    }
    router.push(`/celpip/${s}/${first}?paper_id=${id}` as any);
  };

  return (
    <SafeAreaView style={styles.container} edges={Platform.OS === 'web' ? [] : ['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        {loading && <ActivityIndicator color={CelpipTheme.primary} />}
        {!!error && <Text style={styles.error}>加载失败：{error}</Text>}

        {!!paper && (
          <View style={styles.header}>
            <Text style={styles.title}>{paper.title}</Text>
            <View style={styles.metaRow}>
              <View style={styles.badge}><Text style={styles.badgeText}>{paper.difficulty}</Text></View>
              <Text style={styles.metaText}>状态：{paper.status}</Text>
            </View>
          </View>
        )}

        <View style={styles.sectionRow}>
          {SECTIONS.map(s => {
            const total = counts[s.key] || 0;
            const done = progress[s.key] || 0;
            return (
              <TouchableOpacity
                key={s.key}
                style={[styles.sectionCard, { borderTopColor: CelpipTheme.section[s.key] }]}
                activeOpacity={0.85}
                onPress={() => enterSection(s.key)}
              >
                <Text style={styles.sectionIcon}>{s.icon}</Text>
                <Text style={styles.sectionLabel}>{s.label}</Text>
                <Text style={styles.sectionDesc}>{s.desc}</Text>
                <View style={styles.progressRow}>
                  <View style={styles.progressBar}>
                    <View style={[styles.progressFill, {
                      width: total > 0 ? `${Math.min(100, (done / total) * 100)}%` : '0%',
                      backgroundColor: CelpipTheme.section[s.key],
                    }]} />
                  </View>
                  <Text style={styles.progressText}>{done}/{total}</Text>
                </View>
                <Text style={styles.sectionEnter}>{done > 0 ? '继续 →' : '开始 →'}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: CelpipTheme.background },
  content: { padding: 24, paddingBottom: 60, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  header: { marginBottom: 24 },
  title: { fontSize: 26, fontWeight: '700', color: CelpipTheme.primary, marginBottom: 8 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: '#EEF4FB' },
  badgeText: { color: CelpipTheme.primary, fontWeight: '700', fontSize: 12 },
  metaText: { color: CelpipTheme.textMuted, fontSize: 13 },
  sectionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  sectionCard: {
    flexBasis: 240, flexGrow: 1, padding: 20, borderRadius: 12,
    backgroundColor: CelpipTheme.surfaceElevated,
    borderWidth: 1, borderColor: CelpipTheme.border, borderTopWidth: 4,
  },
  sectionIcon: { fontSize: 28, marginBottom: 8 },
  sectionLabel: { fontSize: 16, fontWeight: '700', color: CelpipTheme.text, marginBottom: 6 },
  sectionDesc: { fontSize: 12, color: CelpipTheme.textMuted, marginBottom: 12, lineHeight: 18 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  progressBar: { flex: 1, height: 6, backgroundColor: CelpipTheme.divider, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%' },
  progressText: { fontSize: 11, color: CelpipTheme.textSubtle, fontWeight: '600' },
  sectionEnter: { color: CelpipTheme.primary, fontWeight: '600' },
  error: { color: CelpipTheme.danger, marginTop: 12 },
});
