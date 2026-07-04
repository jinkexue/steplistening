import { StyleSheet, Text, View, TextInput, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Colors from '@/constants/Colors';

export default function DictationScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text style={styles.title}>听写练习</Text>
          
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              placeholder="输入YouTube链接..."
              placeholderTextColor="#888"
            />
            <TouchableOpacity style={styles.button}>
              <Text style={styles.buttonText}>添加并开始</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>视频区域</Text>
            <View style={styles.videoPlaceholder}>
              <Text style={styles.placeholderText}>YouTube播放器</Text>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>YouTube转写全文</Text>
            </View>
            <View style={styles.transcriptArea}>
              <Text style={styles.placeholderText}>加载视频后，这里会显示对应YouTube文本转写全文。</Text>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>听写片段</Text>
            </View>
            <ScrollView style={styles.recordsArea}>
              <Text style={styles.placeholderText}>暂无听写记录</Text>
            </ScrollView>
          </View>
        </View>
      </ScrollView>

      <View style={styles.bottomBar}>
        <View style={styles.bottomBarContent}>
          <TouchableOpacity style={styles.micButton}>
            <Text style={styles.micIcon}>🎤</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.bottomInput}
            placeholder="在此输入文字..."
            placeholderTextColor="#888"
            multiline
          />
          <TouchableOpacity style={styles.submitButton}>
            <Text style={styles.buttonText}>提交</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 180,
  },
  section: {
    gap: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.dark.primary,
  },
  inputContainer: {
    gap: 12,
  },
  input: {
    backgroundColor: Colors.dark.card,
    borderColor: '#444',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    color: Colors.dark.text,
    fontSize: 16,
  },
  button: {
    backgroundColor: Colors.dark.primary,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  card: {
    backgroundColor: Colors.dark.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  cardHeader: {
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Colors.dark.primary,
  },
  videoPlaceholder: {
    height: 200,
    backgroundColor: '#000',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transcriptArea: {
    minHeight: 200,
  },
  recordsArea: {
    minHeight: 200,
  },
  placeholderText: {
    color: '#888',
    textAlign: 'center',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.dark.card,
    borderTopColor: '#333',
    borderTopWidth: 1,
    padding: 16,
    paddingBottom: 32,
  },
  bottomBarContent: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  micButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.dark.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micIcon: {
    fontSize: 24,
  },
  bottomInput: {
    flex: 1,
    backgroundColor: Colors.dark.background,
    borderColor: '#444',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    color: Colors.dark.text,
    fontSize: 16,
    maxHeight: 80,
  },
  submitButton: {
    backgroundColor: Colors.dark.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
