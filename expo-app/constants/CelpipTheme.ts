// CELPIP 官方风格主题（蓝白）
// 与现有 constants/Colors.ts 深色主题共存，不影响原有听写/生词本模块

const CelpipTheme = {
  // 品牌主色（近似 CELPIP 官方蓝）
  primary: '#0055A4',
  primaryDark: '#003F7D',
  primaryLight: '#3F84C7',
  accent: '#F5A623',        // 高亮/警示（如倒计时最后 10 秒）
  success: '#2E9F5B',
  danger: '#D64545',

  // 中性色
  background: '#FFFFFF',
  surface: '#F5F7FA',
  surfaceElevated: '#FFFFFF',
  border: '#E1E6ED',
  divider: '#EDF0F3',

  // 文本
  text: '#1B1F23',
  textMuted: '#5C6773',
  textSubtle: '#8A94A6',
  textOnPrimary: '#FFFFFF',

  // 板块专属色（用于试卷首页 4 个卡片区分）
  section: {
    listening: '#3F84C7',
    reading:   '#2E9F5B',
    writing:   '#F5A623',
    speaking:  '#A55BD6',
  },

  // 阴影
  shadow: 'rgba(0, 85, 164, 0.08)',
  radius: {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
  },
  spacing: {
    xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32,
  },
  typography: {
    title: 24,
    subtitle: 18,
    body: 15,
    caption: 12,
  },
};

export default CelpipTheme;
