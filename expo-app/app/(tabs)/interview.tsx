import { StyleSheet, Text, View, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Colors from '@/constants/Colors';

export default function InterviewScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text style={styles.title}>面试练习</Text>
          
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.button}>
              <Text style={styles.buttonText}>➕ 新建岗位</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.grid}>
            <View style={styles.sidebar}>
              <Text style={styles.sidebarTitle}>岗位清单</Text>
              <View style={styles.emptyState}>
                <Text style={styles.placeholderText}>暂无岗位</Text>
              </View>
            </View>

            <View style={styles.mainContent}>
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>问题回答</Text>
                </View>
                <View style={styles.emptyState}>
                  <Text style={styles.placeholderText}>选择一个问题开始练习</Text>
                </View>
              </View>

              <View style={styles.card}>
                <View style={styles.inputContainer}>
                  <View style={styles.micRow}>
                    <TouchableOpacity style={styles.micButton}>
                      <Text style={styles.micIcon}>🎤</Text>
                    </TouchableOpacity>
                    <Text style={styles.micStatus}>点击录音</Text>
                    <TouchableOpacity style={styles.button}>
                      <Text style={styles.buttonText}>✓ 保存</Text>
                    </TouchableOpacity>
                  </View>
                  <TextInput
                    style={styles.textArea}
                    placeholder="输入或粘贴回答文字..."
                    placeholderTextColor="#888"
                    multiline
                    numberOfLines={4}
                  />
                </View>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
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
  },
  section: {
    gap: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.dark.primary,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  button: {
    backgroundColor: Colors.dark.primary,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 14,
  },
  grid: {
    gap: 16,
  },
  sidebar: {
    backgroundColor: Colors.dark.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  sidebarTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Colors.dark.primary,
    marginBottom: 12,
  },
  mainContent: {
    gap: 16,
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
  emptyState: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  placeholderText: {
    color: '#888',
  },
  inputContainer: {
    gap: 12,
  },
  micRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  micButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.dark.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micIcon: {
    fontSize: 20,
  },
  micStatus: {
    flex: 1,
    color: '#888',
    fontSize: 12,
  },
  textArea: {
    backgroundColor: Colors.dark.background,
    borderColor: '#444',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    color: Colors.dark.text,
    fontSize: 14,
    minHeight: 100,
    textAlignVertical: 'top',
  },
});
