import { StyleSheet, Text, View, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Colors from '@/constants/Colors';

export default function TasksScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text style={styles.title}>学习控制台</Text>
          
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              placeholder="输入YouTube链接..."
              placeholderTextColor="#888"
            />
            <TouchableOpacity style={[styles.button, styles.secondaryButton]}>
              <Text style={styles.buttonText}>添加</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>我的听写任务</Text>
            </View>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableCell, { flex: 1 }]}>最近活动</Text>
              <Text style={[styles.tableCell, { flex: 2 }]}>视频标题</Text>
              <Text style={[styles.tableCell, { flex: 1 }]}>完成度</Text>
              <Text style={[styles.tableCell, { flex: 1 }]}>操作</Text>
            </View>
            <View style={styles.emptyState}>
              <Text style={styles.placeholderText}>暂无任务</Text>
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
  inputContainer: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: Colors.dark.card,
    borderColor: '#444',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    color: Colors.dark.text,
    fontSize: 14,
  },
  button: {
    backgroundColor: Colors.dark.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
  },
  secondaryButton: {
    backgroundColor: Colors.dark.accent,
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 14,
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
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.primary,
  },
  tableHeader: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  tableCell: {
    color: '#888',
    fontSize: 11,
  },
  emptyState: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  placeholderText: {
    color: '#888',
  },
});
