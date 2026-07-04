# Elearning Expo App

这是一个用于 Elearning 项目的 Expo 移动应用，提供听写练习、生词本、面试练习和任务管理功能。

## 开始使用

### 前置条件

- 安装 Node.js（推荐 v18 或更高）
- 安装 Expo Go 应用在你的手机上
  - iOS: App Store
  - Android: Google Play

### 安装依赖

```bash
cd expo-app
npm install
```

### 启动开发服务器

```bash
npm start
```

或者直接双击项目根目录的 `start-expo.bat`。

启动后，你可以：
- 扫描 QR 码在 Expo Go 应用中预览
- 按 `a` 在 Android 模拟器中打开
- 按 `w` 在 Web 浏览器中打开

## 远程 D1 数据库说明

Expo Go 手机端不能直接访问 Cloudflare D1，它需要通过 Cloudflare Pages Functions API 访问数据库。

当前远程 API 配置在：

```text
config/api.ts
```

默认地址：

```text
https://steplistening.pages.dev
```

如果你的 Cloudflare Pages 正式地址或自定义域名不是这个，请修改：

```ts
export const API_ORIGIN = '你的线上地址';
```

登录页会请求：

```text
POST /api/user
```

请求内容：

```json
{
  "action": "login",
  "username": "用户名",
  "password": "密码"
}
```

“本地测试免登录进入”只用于 UI 调试，不会读取远程 D1 用户数据。

## 项目结构

```text
expo-app/
├── app/
│   ├── (tabs)/
│   │   ├── index.tsx         # 听写练习页面
│   │   ├── vocab.tsx         # 生词本页面
│   │   ├── interview.tsx     # 面试练习页面
│   │   └── tasks.tsx         # 任务管理页面
│   ├── _layout.tsx           # 根布局
│   └── login.tsx             # 登录页面
├── config/
│   └── api.ts                # 远程 API 地址配置
├── constants/
│   └── Colors.ts             # 颜色主题
├── package.json
├── tsconfig.json
├── babel.config.js
└── app.json                  # Expo配置
```

## 技术栈

- React Native
- Expo SDK 54
- Expo Router
- TypeScript

## 主题

应用使用深色主题，配色方案与 Web 版本保持一致：
- 主色: #e94560
- 背景: #12121a
- 卡片: #1a1a2e
- 强调: #0f3460
