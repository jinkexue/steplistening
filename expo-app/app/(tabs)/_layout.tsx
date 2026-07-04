import React from 'react';
import { Platform } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TopTabBar from '@/components/TopTabBar';

function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>['name'];
  color: string;
}) {
  return <FontAwesome size={26} style={{ marginBottom: -2 }} {...props} />;
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, 18);
  const isWeb = Platform.OS === 'web';

  // Web 端使用顶部 TopTabBar；原生保留深色底部 Tab
  const commonScreenOptions = isWeb
    ? {
        headerShown: false,
      }
    : {
        tabBarActiveTintColor: '#e94560',
        tabBarInactiveTintColor: '#8a8a9a',
        tabBarStyle: {
          backgroundColor: '#1a1a2e',
          borderTopColor: '#333',
          height: 58 + bottomInset,
          paddingBottom: bottomInset,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          marginTop: 2,
        },
        headerStyle: { backgroundColor: '#1a1a2e' },
        headerTintColor: '#f0f0f0',
      };

  return (
    <Tabs
      screenOptions={commonScreenOptions as any}
      tabBar={isWeb ? (props) => <TopTabBar {...props} /> : undefined}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '听写主页',
          tabBarIcon: ({ color }) => <TabBarIcon name="play-circle" color={color} />,
        }}
      />
      <Tabs.Screen
        name="vocab"
        options={{
          title: '生词本',
          tabBarIcon: ({ color }) => <TabBarIcon name="book" color={color} />,
        }}
      />
      <Tabs.Screen
        name="interview"
        options={{
          title: '面试练习',
          tabBarIcon: ({ color }) => <TabBarIcon name="microphone" color={color} />,
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: '任务列表',
          tabBarIcon: ({ color }) => <TabBarIcon name="list" color={color} />,
        }}
      />
      <Tabs.Screen
        name="celpip"
        options={{
          title: 'CELPIP',
          tabBarIcon: ({ color }) => <TabBarIcon name="graduation-cap" color={color} />,
        }}
      />
    </Tabs>
  );
}
