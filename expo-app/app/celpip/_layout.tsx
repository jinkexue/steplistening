import React from 'react';
import { Stack } from 'expo-router';

export default function CelpipStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#FFFFFF' },
        headerTintColor: '#0055A4',
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      <Stack.Screen name="paper/[id]" options={{ title: '试卷详情' }} />
      <Stack.Screen name="listening/[itemId]" options={{ title: '听力练习' }} />
      <Stack.Screen name="reading/[itemId]" options={{ title: '阅读练习' }} />
      <Stack.Screen name="writing/[itemId]" options={{ title: '写作练习' }} />
      <Stack.Screen name="speaking/[itemId]" options={{ title: '口语练习' }} />
    </Stack>
  );
}
