import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import CelpipTheme from '@/constants/CelpipTheme';

// 管理员后台入口页；M2 会补充详细子页面
export default function AdminHome() {
  const router = useRouter();
  const entries = [
    { key: 'settings', label: 'AI 配置',     desc: '火山方舟 endpoint / model 引用名（VOLC_API_KEY 走 wrangler secret）' },
    { key: 'papers',   label: '试卷管理',   desc: '新建试卷 / 一键生成 / 查看/编辑单题' },
    { key: 'prompts',  label: '提示词模板', desc: '4 大板块 + 评分/生图 的 system prompt 版本管理' },
  ];
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>管理员后台</Text>
        <Text style={styles.sub}>M1 骨架：路由和 API 已就绪，页面内容将在 M2 补齐。</Text>
        <View style={styles.grid}>
          {entries.map(e => (
            <TouchableOpacity
              key={e.key}
              style={styles.card}
              activeOpacity={0.85}
              onPress={() => router.push(`/admin/${e.key}` as any)}
            >
              <Text style={styles.cardTitle}>{e.label}</Text>
              <Text style={styles.cardDesc}>{e.desc}</Text>
              <Text style={styles.enter}>进入 →</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: CelpipTheme.background },
  content: { padding: 24, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  title: { fontSize: 26, fontWeight: '700', color: CelpipTheme.primary, marginBottom: 6 },
  sub: { fontSize: 13, color: CelpipTheme.textMuted, marginBottom: 24 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  card: {
    flexBasis: 300, flexGrow: 1, padding: 20, borderRadius: 12,
    backgroundColor: CelpipTheme.surfaceElevated,
    borderWidth: 1, borderColor: CelpipTheme.border,
  },
  cardTitle: { fontSize: 17, fontWeight: '700', color: CelpipTheme.text, marginBottom: 8 },
  cardDesc: { fontSize: 12, color: CelpipTheme.textMuted, marginBottom: 12, lineHeight: 18 },
  enter: { color: CelpipTheme.primary, fontWeight: '600' },
});
