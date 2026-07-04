import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import CelpipTheme from '@/constants/CelpipTheme';

// 占位页：M6 会替换为真实口语答题界面（Prep/Recording 倒计时 + 录音 + Whisper + LLM 反馈）
export default function SpeakingPlaceholder() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.box}>
        <Text style={styles.title}>Speaking 板块</Text>
        <Text style={styles.desc}>M1 骨架已就绪，真实答题界面将在 M6 阶段接入。</Text>
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: CelpipTheme.background },
  box: { padding: 32, alignItems: 'center', justifyContent: 'center', flex: 1 },
  title: { fontSize: 22, fontWeight: '700', color: CelpipTheme.primary, marginBottom: 12 },
  desc: { color: CelpipTheme.textMuted, textAlign: 'center' },
});
