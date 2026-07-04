import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import CelpipTheme from '@/constants/CelpipTheme';

// 顶部 Tab 栏（仅 Web 使用；原生保留系统底部 Tabs）
export default function TopTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  return (
    <View style={styles.wrapper}>
      <View style={styles.inner}>
        <View style={styles.brandBlock}>
          <Text style={styles.brand}>StepListening</Text>
        </View>
        <View style={styles.tabs}>
          {state.routes.map((route, index) => {
            const { options } = descriptors[route.key];
            const label =
              typeof options.tabBarLabel === 'string'
                ? options.tabBarLabel
                : options.title ?? route.name;
            const focused = state.index === index;

            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            };

            return (
              <TouchableOpacity
                key={route.key}
                accessibilityRole="button"
                accessibilityState={focused ? { selected: true } : {}}
                onPress={onPress}
                style={[styles.tabBtn, focused && styles.tabBtnActive]}
                activeOpacity={0.7}
              >
                <Text style={[styles.tabText, focused && styles.tabTextActive]}>
                  {label as string}
                </Text>
                {focused && <View style={styles.underline} />}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: CelpipTheme.border,
    ...Platform.select({
      web: {
        // web 端固定在顶部（可选：想要粘性就取消注释）
        // position: 'sticky' as any,
        // top: 0,
        // zIndex: 100,
      },
    }),
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    height: 60,
    maxWidth: 1200,
    marginHorizontal: 'auto' as any,
    width: '100%',
  },
  brandBlock: {
    marginRight: 24,
  },
  brand: {
    fontSize: 18,
    fontWeight: '700',
    color: CelpipTheme.primary,
  },
  tabs: {
    flexDirection: 'row',
    gap: 4,
    flex: 1,
  },
  tabBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBtnActive: {
    backgroundColor: '#EEF4FB',
  },
  tabText: {
    fontSize: 14,
    color: CelpipTheme.textMuted,
    fontWeight: '500',
  },
  tabTextActive: {
    color: CelpipTheme.primary,
    fontWeight: '700',
  },
  underline: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: -2,
    height: 2,
    backgroundColor: CelpipTheme.primary,
    borderRadius: 1,
  },
});
