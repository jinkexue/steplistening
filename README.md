# 听写助手 Pro - Cloudflare Workers 全栈应用

使用 Hono 框架、Cloudflare Workers、D1 数据库和 R2 存储桶打造的高性能听写应用。

## 🚀 快速开始

### 前置要求
- Node.js 18+
- Wrangler CLI (`npm install -g wrangler`)
- Cloudflare 账户

### 1. 初始化项目

```bash
npm install
```

### 2. 创建 D1 数据库

```bash
wrangler d1 create dictation_db
```

复制输出的 `database_id`，更新 `wrangler.toml` 中的 `database_id` 值。

### 3. 初始化数据库表

```bash
wrangler d1 execute dictation_db --file schema.sql
```

### 4. 创建 R2 存储桶

```bash
wrangler r2 bucket create dictation-audio
```

### 5. 本地开发

```bash
npm run dev
```

访问 `http://localhost:8787`

### 6. 部署到 Cloudflare

```bash
npm run deploy
```

## 📚 API 文档

### 用户管理

#### 创建用户
```bash
POST /api/users
Content-Type: application/json

{
  "username": "user123"
}
```

#### 获取用户列表
```bash
GET /api/users
```

#### 获取单个用户
```bash
GET /api/users/:id
```

### 听写记录管理

#### 创建记录
```bash
POST /api/records
Content-Type: application/json

{
  "user_id": 1,
  "video_id": "dQw4w9WgXcQ",
  "timestamp": 1619000000,
  "text": "最终听写文字",
  "audio_key": "audio/xxx.webm"
}
```

#### 获取用户的所有记录
```bash
GET /api/users/:user_id/records
```

#### 查询记录（支持过滤）
```bash
GET /api/records?user_id=1&video_id=dQw4w9WgXcQ
```

#### 删除记录
```bash
DELETE /api/records/:id
```

### 音频处理

#### 上传音频
```bash
POST /api/upload-audio
Content-Type: multipart/form-data

[二进制音频文件]
```

#### 获取音频
```bash
GET /api/audio/:path
```

### 健康检查
```bash
GET /api/health
```

## 🗂️ 项目结构

```
.
├── wrangler.toml          # Cloudflare 配置
├── schema.sql             # 数据库初始化脚本
├── package.json           # 项目依赖
├── tsconfig.json          # TypeScript 配置
├── src/
│   └── index.ts           # 主应用文件
└── README.md              # 文档
```

## 📊 数据库表结构

### users 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键 |
| username | TEXT | 用户名（唯一） |
| created_at | DATETIME | 创建时间 |

### records 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键 |
| user_id | INTEGER | 用户 ID（外键） |
| video_id | TEXT | 视频 ID |
| timestamp | INTEGER | 视频时间戳 |
| text | TEXT | 听写文字内容 |
| audio_key | TEXT | R2 音频文件路径 |
| created_at | DATETIME | 创建时间 |

## 🔒 安全建议

- 添加身份验证（JWT、OAuth）
- 实施请求速率限制
- 验证用户输入
- 使用 HTTPS
- 定期备份数据

## 🛠️ 开发技巧

### 本地测试 API

```bash
# 创建用户
curl -X POST http://localhost:8787/api/users \
  -H "Content-Type: application/json" \
  -d '{"username":"test"}'

# 获取用户
curl http://localhost:8787/api/users/1
```

### 调试 D1 查询

```bash
wrangler d1 execute dictation_db --interactive
```

### 查看 R2 存储桶内容

```bash
wrangler r2 object list dictation-audio
```

## 📝 下一步

1. **集成前端**：修改 index.html 以调用 API 端点
2. **添加认证**：实现用户登录和会话管理
3. **优化性能**：添加缓存和 CDN 配置
4. **监控日志**：配置 Cloudflare 分析和日志

## 📄 许可证

MIT
