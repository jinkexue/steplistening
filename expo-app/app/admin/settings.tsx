import React, { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet, Text, View, TextInput, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import CelpipTheme from '@/constants/CelpipTheme';
import { API_BASE } from '@/config/api';

// 与后端 ALLOWED_KEYS 保持一致
const SETTING_KEYS: Array<{ key: string; label: string; hint: string }> = [
  { key: 'volc_api_endpoint', label: '火山方舟 endpoint',       hint: '例：https://ark.cn-beijing.volces.com/api/v3' },
  { key: 'volc_llm_model',    label: '火山 LLM model 引用名',    hint: '方舟平台申请到的文本模型 endpoint id / model' },
  { key: 'volc_vision_model', label: '火山 Vision model 引用名', hint: '图文多模态模型（可留空）' },
  { key: 'volc_image_model',  label: '火山 Image model 引用名',  hint: '文生图模型（Speaking Task3/4 需要）' },
  { key: 'volc_tts_model',    label: '火山 TTS 备选 model',      hint: '备选。主 TTS 走 Cloudflare' },
  { key: 'volc_stt_model',    label: '火山 STT 备选 model',      hint: '备选。主 STT 走 Cloudflare Whisper' },
  { key: 'cf_tts_model',      label: 'Cloudflare TTS 模型',      hint: '例：@cf/deepgram/aura-2-en' },
  { key: 'cf_stt_model',      label: 'Cloudflare STT 模型',      hint: '例：@cf/openai/whisper' },
];

async function getAdminUserId(): Promise<number | null> {
  if (Platform.OS === 'web') {
    const v = window.localStorage?.getItem('user_id');
    return v ? Number(v) : null;
  }
  return null;
}

export default function AdminSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [secrets, setSecrets] = useState<{ VOLC_API_KEY: boolean }>({ VOLC_API_KEY: false });
  const [userId, setUserId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const uid = await getAdminUserId();
      setUserId(uid);
      if (!uid) { setError('请先登录管理员账号'); setLoading(false); return; }
      const res = await fetch(`${API_BASE}/admin/settings?user_id=${uid}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setValues(data.settings || {});
      setSecrets(data.secrets || { VOLC_API_KEY: false });
    } catch (e: any) {
      setError(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!userId) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/admin/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, updates: values }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      Alert.alert('已保存', '配置已写入 D1 app_settings 表');
    } catch (e: any) {
      Alert.alert('保存失败', e.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>AI 配置</Text>
        <Text style={styles.sub}>
          此处仅存放模型引用名。VOLC_API_KEY 等敏感值请到
          Cloudflare Dashboard → Pages 项目 → Settings → Environment variables 设置为 encrypted 变量。
        </Text>

        <View style={styles.secretBox}>
          <Text style={styles.secretLabel}>VOLC_API_KEY 状态：</Text>
          <Text style={[styles.secretValue, { color: secrets.VOLC_API_KEY ? CelpipTheme.success : CelpipTheme.danger }]}>
            {secrets.VOLC_API_KEY ? '已配置 ✓' : '未配置 ✗'}
          </Text>
        </View>

        {loading && <ActivityIndicator color={CelpipTheme.primary} style={{ marginTop: 24 }} />}
        {!!error && <Text style={styles.error}>加载失败：{error}</Text>}

        {!loading && !error && (
          <View style={styles.form}>
            {SETTING_KEYS.map(s => (
              <View key={s.key} style={styles.field}>
                <Text style={styles.fieldLabel}>{s.label}</Text>
                <Text style={styles.fieldHint}>{s.hint}</Text>
                <TextInput
                  style={styles.input}
                  value={values[s.key] ?? ''}
                  onChangeText={(t) => setValues(v => ({ ...v, [s.key]: t }))}
                  placeholder={s.hint}
                  placeholderTextColor={CelpipTheme.textSubtle}
                  autoCapitalize="none"
                />
              </View>
            ))}
            <TouchableOpacity style={styles.primaryBtn} onPress={save} disabled={saving} activeOpacity={0.85}>
              <Text style={styles.primaryBtnText}>{saving ? '保存中…' : '保存配置'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: CelpipTheme.background },
  content: { padding: 24, maxWidth: 900, width: '100%', alignSelf: 'center' },
  title: { fontSize: 26, fontWeight: '700', color: CelpipTheme.primary, marginBottom: 6 },
  sub: { fontSize: 13, color: CelpipTheme.textMuted, marginBottom: 16, lineHeight: 20 },
  secretBox: {
    padding: 16, borderRadius: 8, backgroundColor: CelpipTheme.surface,
    borderWidth: 1, borderColor: CelpipTheme.border,
    flexDirection: 'row', alignItems: 'center', marginBottom: 24,
  },
  secretLabel: { color: CelpipTheme.text, fontWeight: '600' },
  secretValue: { fontWeight: '700', marginLeft: 8 },
  form: { gap: 16 },
  field: { gap: 4 },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: CelpipTheme.text },
  fieldHint: { fontSize: 11, color: CelpipTheme.textSubtle, marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: CelpipTheme.border, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: '#FFF', color: CelpipTheme.text, fontSize: 14,
  },
  primaryBtn: {
    marginTop: 12, backgroundColor: CelpipTheme.primary,
    paddingVertical: 12, borderRadius: 8, alignItems: 'center',
  },
  primaryBtnText: { color: '#FFF', fontWeight: '700', fontSize: 15 },
  error: { color: CelpipTheme.danger, marginTop: 12 },
});
