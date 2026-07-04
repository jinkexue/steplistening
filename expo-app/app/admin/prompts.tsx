import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  StyleSheet, Text, View, TextInput, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import CelpipTheme from '@/constants/CelpipTheme';
import { API_BASE } from '@/config/api';

type Prompt = {
  id: number;
  section: string;
  name: string;
  system_prompt: string;
  version: number;
  active: number;
  updated_at: string;
};

const SECTION_LABEL: Record<string, string> = {
  listening: '听力生成',
  reading: '阅读生成',
  writing: '写作生成',
  speaking: '口语生成',
  scoring: '评分',
  image: '生图 Prompt',
};

function getUserId(): number | null {
  if (Platform.OS !== 'web') return null;
  const v = window.localStorage?.getItem('user_id');
  return v ? Number(v) : null;
}

export default function AdminPrompts() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [userId, setUserId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const uid = getUserId();
      setUserId(uid);
      if (!uid) { setError('请先登录管理员账号'); setLoading(false); return; }
      const res = await fetch(`${API_BASE}/admin/prompts?user_id=${uid}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setPrompts(data.prompts || []);
    } catch (e: any) { setError(e.message || '加载失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => {
    const map: Record<string, Prompt[]> = {};
    for (const p of prompts) {
      (map[p.section] ||= []).push(p);
    }
    return map;
  }, [prompts]);

  const savePrompt = async (p: Prompt) => {
    if (!userId) return;
    const nextText = drafts[p.id] ?? p.system_prompt;
    try {
      const res = await fetch(`${API_BASE}/admin/prompts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          action: 'update',
          id: p.id,
          system_prompt: nextText,
          version: p.version + 1,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      Alert.alert('已保存', `版本递增到 v${p.version + 1}`);
      load();
    } catch (e: any) {
      Alert.alert('保存失败', e.message);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>提示词模板</Text>
        <Text style={styles.sub}>按板块分组，一键保存会自动递增版本号，最新版本自动生效。</Text>

        {loading && <ActivityIndicator color={CelpipTheme.primary} />}
        {!!error && <Text style={styles.error}>加载失败：{error}</Text>}

        {!loading && !error && Object.keys(grouped).map(section => (
          <View key={section} style={styles.group}>
            <Text style={styles.groupTitle}>
              {SECTION_LABEL[section] || section} <Text style={styles.groupCode}>[{section}]</Text>
            </Text>
            {grouped[section].map(p => (
              <View key={p.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardName}>{p.name}</Text>
                  <Text style={styles.cardVersion}>v{p.version} · {p.active ? '启用' : '停用'}</Text>
                </View>
                <TextInput
                  style={styles.textarea}
                  value={drafts[p.id] ?? p.system_prompt}
                  onChangeText={(t) => setDrafts(d => ({ ...d, [p.id]: t }))}
                  multiline
                  numberOfLines={6}
                />
                <TouchableOpacity style={styles.saveBtn} onPress={() => savePrompt(p)} activeOpacity={0.85}>
                  <Text style={styles.saveBtnText}>保存并递增版本</Text>
                </TouchableOpacity>
              </View>
            ))}
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
  sub: { fontSize: 13, color: CelpipTheme.textMuted, marginBottom: 24 },
  group: { marginBottom: 32 },
  groupTitle: { fontSize: 16, fontWeight: '700', color: CelpipTheme.text, marginBottom: 12 },
  groupCode: { color: CelpipTheme.textSubtle, fontSize: 12, fontWeight: '400' },
  card: {
    padding: 16, borderRadius: 10, backgroundColor: CelpipTheme.surfaceElevated,
    borderWidth: 1, borderColor: CelpipTheme.border, marginBottom: 12,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  cardName: { fontWeight: '700', color: CelpipTheme.text },
  cardVersion: { color: CelpipTheme.textSubtle, fontSize: 12 },
  textarea: {
    borderWidth: 1, borderColor: CelpipTheme.border, borderRadius: 6,
    padding: 10, minHeight: 120, color: CelpipTheme.text,
    fontSize: 13, textAlignVertical: 'top', backgroundColor: '#FFF',
  },
  saveBtn: {
    marginTop: 10, alignSelf: 'flex-end',
    backgroundColor: CelpipTheme.primary,
    paddingVertical: 8, paddingHorizontal: 16, borderRadius: 6,
  },
  saveBtnText: { color: '#FFF', fontWeight: '700', fontSize: 13 },
  error: { color: CelpipTheme.danger, marginTop: 12 },
});
