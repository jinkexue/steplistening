import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import CelpipTheme from '@/constants/CelpipTheme';
import { API_BASE } from '@/config/api';

type Paper = {
  id: number;
  title: string;
  difficulty: string;
  status: string;
  created_at: string;
};

// TODO: 接入登录态获取当前 user_id；M1 先允许游客浏览
async function fetchPapers(userId?: number): Promise<{ papers: Paper[]; progress: Record<string, any> }> {
  const url = new URL(`${API_BASE}/celpip/papers`);
  url.searchParams.set('status', 'published');
  if (userId) url.searchParams.set('user_id', String(userId));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

function readLocalUser() {
  if (Platform.OS !== 'web') return { userId: null as number | null, isAdmin: false };
  try {
    const uid = window.localStorage?.getItem('user_id');
    const admin = window.localStorage?.getItem('is_admin');
    return {
      userId: uid ? Number(uid) : null,
      isAdmin: admin === '1' || admin === 'true',
    };
  } catch { return { userId: null as number | null, isAdmin: false }; }
}

export default function CelpipHomeScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { userId, isAdmin } = readLocalUser();
      setIsAdmin(isAdmin);
      const { papers } = await fetchPapers(userId ?? undefined);
      setPapers(papers || []);
    } catch (e: any) {
      setError(e.message || 'load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={styles.container} edges={Platform.OS === 'web' ? [] : ['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>CELPIP 英语学习</Text>
            <Text style={styles.heroSub}>选择一份试卷，进入听 / 说 / 读 / 写 完整练习</Text>
          </View>
          {isAdmin && (
            <TouchableOpacity
              style={styles.adminEntry}
              onPress={() => router.push('/admin' as any)}
              activeOpacity={0.85}
            >
              <Text style={styles.adminEntryText}>⚙️ 管理员后台</Text>
            </TouchableOpacity>
          )}
        </View>

        {loading && <ActivityIndicator color={CelpipTheme.primary} style={{ marginTop: 24 }} />}
        {!!error && <Text style={styles.errorText}>加载失败：{error}</Text>}

        {!loading && !error && papers.length === 0 && (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>暂无已发布试卷</Text>
            <Text style={styles.emptyDesc}>
              管理员可在「后台 → 试卷管理」一键生成试卷；生成完成后此处将显示可练习的试卷列表。
            </Text>
          </View>
        )}

        <View style={styles.grid}>
          {papers.map(p => (
            <TouchableOpacity
              key={p.id}
              style={styles.card}
              activeOpacity={0.85}
              onPress={() => router.push(`/celpip/paper/${p.id}` as any)}
            >
              <View style={styles.cardBadge}>
                <Text style={styles.cardBadgeText}>{p.difficulty || 'CLB9'}</Text>
              </View>
              <Text style={styles.cardTitle} numberOfLines={2}>{p.title}</Text>
              <Text style={styles.cardMeta}>创建于 {new Date(p.created_at).toLocaleDateString()}</Text>
              <View style={styles.cardFooter}>
                <Text style={styles.enterText}>进入练习 →</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CelpipTheme.background,
  },
  content: {
    padding: 24,
    paddingBottom: 60,
    maxWidth: 1200,
    width: '100%',
    alignSelf: 'center',
  },
  hero: {
    paddingVertical: 24,
    borderBottomWidth: 1,
    borderBottomColor: CelpipTheme.border,
    marginBottom: 24,
    flexDirection: 'row',
    alignItems: 'center',
  },
  adminEntry: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#EEF4FB',
    borderWidth: 1,
    borderColor: CelpipTheme.primaryLight,
  },
  adminEntryText: {
    color: CelpipTheme.primary,
    fontWeight: '700',
    fontSize: 13,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: CelpipTheme.primary,
    marginBottom: 6,
  },
  heroSub: {
    fontSize: 15,
    color: CelpipTheme.textMuted,
  },
  emptyBox: {
    padding: 32,
    borderRadius: 12,
    backgroundColor: CelpipTheme.surface,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: CelpipTheme.text,
    marginBottom: 6,
  },
  emptyDesc: {
    fontSize: 13,
    color: CelpipTheme.textMuted,
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  card: {
    width: 280,
    padding: 20,
    borderRadius: 12,
    backgroundColor: CelpipTheme.surfaceElevated,
    borderWidth: 1,
    borderColor: CelpipTheme.border,
  },
  cardBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#EEF4FB',
    marginBottom: 10,
  },
  cardBadgeText: {
    color: CelpipTheme.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: CelpipTheme.text,
    marginBottom: 6,
  },
  cardMeta: {
    fontSize: 12,
    color: CelpipTheme.textSubtle,
    marginBottom: 12,
  },
  cardFooter: {
    marginTop: 8,
  },
  enterText: {
    color: CelpipTheme.primary,
    fontWeight: '600',
  },
  errorText: {
    color: CelpipTheme.danger,
    marginTop: 12,
  },
});
