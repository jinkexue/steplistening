import React from 'react';
import { Stack } from 'expo-router';

export default function AdminLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#FFFFFF' },
        headerTintColor: '#0055A4',
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      <Stack.Screen name="index" options={{ title: '管理员后台' }} />
      <Stack.Screen name="settings" options={{ title: 'AI 配置' }} />
      <Stack.Screen name="papers" options={{ title: '试卷管理' }} />
      <Stack.Screen name="prompts" options={{ title: '提示词模板' }} />
    </Stack>
  );
}
