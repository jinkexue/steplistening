import React, { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet, Text, View, TextInput, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import CelpipTheme from '@/constants/CelpipTheme';
import { API_BASE } from '@/config/api';

type Paper = {
  id: number;
  title: string;
  difficulty: string;
  status: string;
  created_at: string;
};

function getUserId(): number | null {
  if (Platform.OS !== 'web') return null;
  const v = window.localStorage?.getItem('user_id');
  return v ? Number(v) : null;
}

export default function AdminPapers() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [newDifficulty, setNewDifficulty] = useState('CLB9');
  const [creating, setCreating] = useState(false);
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  const [userId, setUserId] = useState<number | null>(null);
  const [migrating, setMigrating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const uid = getUserId();
      setUserId(uid);
      if (!uid) { setError('请先登录管理员账号'); setLoading(false); return; }
      const res = await fetch(`${API_BASE}/admin/papers?user_id=${uid}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setPapers(data.papers || []);
    } catch (e: any) { setError(e.message || '加载失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runMigrate = async () => {
    if (!userId) return;
    setMigrating(true);
    try {
      const res = await fetch(`${API_BASE}/admin/migrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      Alert.alert('迁移完成', `执行 ${data.results?.length || 0} 条语句，请刷新页面。`);
      load();
    } catch (e: any) { Alert.alert('迁移失败', e.message); }
    finally { setMigrating(false); }
  };

  const createPaper = async () => {
    if (!userId) return;
    if (!newTitle.trim()) { Alert.alert('提示', '请填写试卷标题'); return; }
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE}/celpip/papers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          action: 'create',
          title: newTitle.trim(),
          difficulty: newDifficulty,
          status: 'draft',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setNewTitle('');
      load();
    } catch (e: any) { Alert.alert('新建失败', e.message); }
    finally { setCreating(false); }
  };

  const generateAll = async (paperId: number) => {
    if (!userId) return;
    setGeneratingId(paperId);
    try {
      const res = await fetch(`${API_BASE}/admin/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          paper_id: paperId,
          sections: ['listening', 'reading', 'writing', 'speaking'],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const brief = Object.entries(data.summary || {})
        .map(([k, v]: any) => `${k}: ${v.generated || 0}${v.error ? ` (err)` : ''}`)
        .join(' · ');
      Alert.alert('一键生成完成', brief || '完成');
      load();
    } catch (e: any) { Alert.alert('生成失败', e.message); }
    finally { setGeneratingId(null); }
  };

  const setStatus = async (paperId: number, status: string) => {
    if (!userId) return;
    try {
      const res = await fetch(`${API_BASE}/celpip/papers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          action: status === 'published' ? 'publish' : 'update',
          id: paperId,
          status,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      load();
    } catch (e: any) { Alert.alert('状态更新失败', e.message); }
  };

  const deletePaper = async (paperId: number) => {
    if (!userId) return;
    if (Platform.OS === 'web' && !window.confirm('确认删除该试卷？')) return;
    try {
      const res = await fetch(`${API_BASE}/celpip/papers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, action: 'delete', id: paperId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      load();
    } catch (e: any) { Alert.alert('删除失败', e.message); }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>试卷管理</Text>
        <Text style={styles.sub}>
          流程：初始化数据库 → 新建试卷 → 一键生成 → 发布 → 前台可见。VOLC_API_KEY 未配置时，一键生成会返回 500。
        </Text>

        <View style={styles.toolbar}>
          <TouchableOpacity style={styles.utilBtn} onPress={runMigrate} disabled={migrating}>
            <Text style={styles.utilBtnText}>{migrating ? '迁移中…' : '① 初始化 / 更新数据库'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.createBox}>
          <Text style={styles.sectionHeader}>② 新建试卷</Text>
          <TextInput
            style={styles.input}
            value={newTitle}
            onChangeText={setNewTitle}
            placeholder="试卷标题，如：CELPIP 模拟 001"
            placeholderTextColor={CelpipTheme.textSubtle}
          />
          <TextInput
            style={styles.input}
            value={newDifficulty}
            onChangeText={setNewDifficulty}
            placeholder="目标 CLB 等级（默认 CLB9）"
            placeholderTextColor={CelpipTheme.textSubtle}
          />
          <TouchableOpacity style={styles.primaryBtn} onPress={createPaper} disabled={creating}>
            <Text style={styles.primaryBtnText}>{creating ? '创建中…' : '新建试卷'}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionHeader}>③ 试卷列表</Text>
        {loading && <ActivityIndicator color={CelpipTheme.primary} />}
        {!!error && <Text style={styles.error}>加载失败：{error}</Text>}
        {!loading && papers.length === 0 && <Text style={styles.empty}>暂无试卷</Text>}

        {papers.map(p => (
          <View key={p.id} style={styles.paperCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.paperTitle}>{p.title}</Text>
              <Text style={styles.paperMeta}>
                #{p.id} · {p.difficulty} · {p.status === 'published' ? '已发布' : '草稿'} · {new Date(p.created_at).toLocaleDateString()}
              </Text>
            </View>
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.smallBtn, { backgroundColor: CelpipTheme.primary }]}
                disabled={generatingId === p.id}
                onPress={() => generateAll(p.id)}
              >
                <Text style={styles.smallBtnText}>
                  {generatingId === p.id ? '生成中…' : '一键生成'}
                </Text>
              </TouchableOpacity>
              {p.status !== 'published' ? (
                <TouchableOpacity
                  style={[styles.smallBtn, { backgroundColor: CelpipTheme.success }]}
                  onPress={() => setStatus(p.id, 'published')}
                >
                  <Text style={styles.smallBtnText}>发布</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.smallBtn, { backgroundColor: '#999' }]}
                  onPress={() => setStatus(p.id, 'draft')}
                >
                  <Text style={styles.smallBtnText}>撤回</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.smallBtn, { backgroundColor: CelpipTheme.danger }]}
                onPress={() => deletePaper(p.id)}
              >
                <Text style={styles.smallBtnText}>删除</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: CelpipTheme.background },
  content: { padding: 24, maxWidth: 1000, width: '100%', alignSelf: 'center' },
  title: { fontSize: 26, fontWeight: '700', color: CelpipTheme.primary, marginBottom: 6 },
  sub: { fontSize: 13, color: CelpipTheme.textMuted, marginBottom: 16, lineHeight: 20 },
  toolbar: { marginBottom: 24 },
  utilBtn: {
    alignSelf: 'flex-start', paddingVertical: 10, paddingHorizontal: 16,
    borderRadius: 8, backgroundColor: '#EEF4FB', borderWidth: 1, borderColor: CelpipTheme.primaryLight,
  },
  utilBtnText: { color: CelpipTheme.primary, fontWeight: '700' },
  createBox: {
    padding: 16, borderRadius: 10, backgroundColor: CelpipTheme.surface,
    borderWidth: 1, borderColor: CelpipTheme.border,
    marginBottom: 24, gap: 10,
  },
  sectionHeader: { fontSize: 15, fontWeight: '700', color: CelpipTheme.text, marginBottom: 8 },
  input: {
    borderWidth: 1, borderColor: CelpipTheme.border, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: '#FFF', color: CelpipTheme.text, fontSize: 14,
  },
  primaryBtn: {
    backgroundColor: CelpipTheme.primary, paddingVertical: 10, borderRadius: 8, alignItems: 'center',
  },
  primaryBtnText: { color: '#FFF', fontWeight: '700' },
  paperCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: 10, backgroundColor: CelpipTheme.surfaceElevated,
    borderWidth: 1, borderColor: CelpipTheme.border, marginBottom: 10,
  },
  paperTitle: { fontWeight: '700', color: CelpipTheme.text, fontSize: 15 },
  paperMeta: { color: CelpipTheme.textSubtle, fontSize: 12, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 6, flexShrink: 0 },
  smallBtn: {
    paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6,
  },
  smallBtnText: { color: '#FFF', fontWeight: '700', fontSize: 12 },
  empty: { color: CelpipTheme.textMuted, marginVertical: 12 },
  error: { color: CelpipTheme.danger, marginTop: 12 },
});
