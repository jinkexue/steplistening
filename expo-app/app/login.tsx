import { useState } from 'react';
import { router } from 'expo-router';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Colors from '@/constants/Colors';
import { API_BASE, API_ORIGIN } from '@/config/api';

export default function LoginScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  function enterApp() {
    router.replace('/(tabs)');
  }

  async function handleLogin() {
    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();

    if (!trimmedUsername || !trimmedPassword) {
      setMessage('请输入用户名和密码；本地调试也可以点击“免登录进入”。');
      return;
    }

    setIsLoading(true);
    setMessage('正在连接远程 D1 数据库登录...');

    try {
      const response = await fetch(`${API_BASE}/user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'login',
          username: trimmedUsername,
          password: trimmedPassword,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.error || `登录失败，状态码 ${response.status}`);
      }

      // 保存用户身份，供 CELPIP / Admin 后台使用
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        try {
          if (data?.id != null) window.localStorage.setItem('user_id', String(data.id));
          if (data?.username) window.localStorage.setItem('username', String(data.username));
          if (data?.is_admin != null) window.localStorage.setItem('is_admin', String(data.is_admin));
        } catch (_) { /* ignore */ }
      }

      setMessage(`登录成功：${data?.username || trimmedUsername}`);
      enterApp();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      setMessage(`远程登录失败：${errorMessage}\n请确认线上地址和 D1 可用，或先用“本地测试免登录进入”。`);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}
      >
        <View style={styles.content}>
          <View style={styles.logoBox}>
            <Text style={styles.logoIcon}>🎧</Text>
            <Text style={styles.title}>听写达人</Text>
            <Text style={styles.subtitle}>Elearning Mobile Preview</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>登录系统</Text>
            <Text style={styles.apiHint}>远程 API：{API_ORIGIN}</Text>

            <TextInput
              value={username}
              onChangeText={setUsername}
              placeholder="用户名 / 邮箱"
              placeholderTextColor="#7c7c8a"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isLoading}
              style={styles.input}
            />

            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="密码"
              placeholderTextColor="#7c7c8a"
              secureTextEntry
              editable={!isLoading}
              style={styles.input}
            />

            {message ? <Text style={styles.message}>{message}</Text> : null}

            <Pressable
              disabled={isLoading}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, isLoading && styles.disabledButton]}
              onPress={handleLogin}
            >
              {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>登录远程 D1</Text>}
            </Pressable>

            <Pressable
              disabled={isLoading}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed, isLoading && styles.disabledButton]}
              onPress={enterApp}
            >
              <Text style={styles.secondaryButtonText}>本地测试免登录进入</Text>
            </Pressable>
          </View>

          <Text style={styles.hint}>说明：正常登录会请求 Cloudflare Pages API，并使用线上绑定的 D1 数据库。</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  logoBox: {
    alignItems: 'center',
    marginBottom: 28,
  },
  logoIcon: {
    fontSize: 52,
    marginBottom: 10,
  },
  title: {
    color: Colors.dark.primary,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 1,
  },
  subtitle: {
    color: '#9b9baa',
    marginTop: 6,
    fontSize: 14,
  },
  card: {
    backgroundColor: Colors.dark.card,
    borderColor: '#303044',
    borderWidth: 1,
    borderRadius: 24,
    padding: 22,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 8,
  },
  cardTitle: {
    color: Colors.dark.text,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 6,
  },
  apiHint: {
    color: '#8d8da0',
    fontSize: 12,
    marginBottom: 16,
  },
  input: {
    backgroundColor: '#12121a',
    borderColor: '#3d3d52',
    borderWidth: 1,
    borderRadius: 14,
    color: Colors.dark.text,
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 12,
  },
  message: {
    color: '#ffb3bd',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: Colors.dark.primary,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
    minHeight: 52,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryButton: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: '#3d3d52',
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  secondaryButtonText: {
    color: Colors.dark.text,
    fontSize: 15,
    fontWeight: '700',
  },
  pressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.9,
  },
  disabledButton: {
    opacity: 0.65,
  },
  hint: {
    color: '#747486',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 18,
  },
});
