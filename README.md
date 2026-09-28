# HotPulse — AI 热点雷达

多来源定时增量扫描 + AI 分析 + 实时通知的热点监控系统。

## 产品简介

HotPulse 从 Twitter、Bing、Google、搜狗、微博、GitHub、Hacker News、Bilibili 等 **8 个来源**定时扫描用户配置的监控词，通过 AI 完成真实性判断、相关性评分和智能摘要，将符合条件的内容增量写入数据库，并通过 WebSocket 实时推送和邮件通知。

用户只需添加并开启监控词，系统按计划自动扫描。没有手动搜索页面。

## 核心流程

1. 在「监控词」页面添加关键词并开启
2. 定时调度器按配置间隔（默认 30 分钟）扫描所有启用关键词
3. 每个关键词并行查询 8 个来源，单个来源失败不影响其余
4. 增量去重：已存在的内容只更新指标，不重复 AI 分析和通知
5. 新内容经 AI 分析后写入数据库，通过 WebSocket 和邮件通知
6. 在「热点雷达」查看结果，支持来源、重要性、时间、关键词等多维度筛选和排序

## 支持来源

| 来源 | 类型 | 说明 |
|------|------|------|
| Twitter | API | 需要 twitterapi.io API Key |
| Bing | 页面抓取 | 无需 Key，内置频率限制 |
| Google | 页面抓取 | 无需 Key，内置频率限制 |
| 搜狗 | 页面抓取 | 无需 Key |
| 微博 | 公开 API | 热搜榜匹配，无需登录 |
| GitHub | REST API | 可选 Token，支持 `repo:owner/repo` 跟踪 Release |
| Hacker News | Algolia API | 无需 Key |
| Bilibili | 公开 API | 无需 Key |

## 技术栈

- 后端：Express 5 + TypeScript + Prisma (SQLite) + Socket.IO + node-cron
- 前端：React 19 + TypeScript + Vite + Tailwind CSS + Framer Motion
- AI：OpenRouter（GPT-4o-mini / Claude 等模型）
- 容器：Docker Compose

## 快速开始

### 前置条件

- Node.js ≥ 18
- [OpenRouter API Key](https://openrouter.ai/settings/keys)（必需，用于 AI 分析）

### 1. 克隆并安装

```bash
git clone https://gitee.com/mengli-ruo/hotspot-monitoring.git
cd hotspot-monitoring

# 后端
cd server
npm install
npx prisma generate
npx prisma db push

# 前端
cd ../client
npm install
```

### 2. 配置环境变量

```bash
cp server/.env.example server/.env
```

编辑 `server/.env`，至少填入：

```bash
OPENROUTER_API_KEY=sk-or-v1-你的key
# 可选
TWITTER_API_KEY=你的key
GITHUB_TOKEN=你的token
```

### 3. 启动

```bash
# 终端 1：后端（端口 3001）
cd server && npm run dev

# 终端 2：前端（端口 5173）
cd client && npm run dev
```

访问 http://localhost:5173，在「监控词」中添加关键词并开启，定时任务会自动开始扫描。也可以在「定时任务」面板点击「立即扫描」手动触发。

| 服务 | 地址 |
|------|------|
| 前端页面 | http://localhost:5173 |
| 后端 API | http://localhost:3001 |
| 数据库管理 | `cd server && npx prisma studio` |

## 定时调度

调度器通过 `GET/PUT /api/scheduler` 接口和前端面板管理：

- **启停开关**：启用或停用定时扫描
- **间隔配置**：5 / 10 / 15 / 30 / 60 分钟
- **互斥锁**：同一时间只允许一个扫描任务运行
- **重启恢复**：服务重启后根据持久化的 nextRunAt 判断是否补跑
- **运行记录**：每次扫描的新增、更新、过滤数量和各来源耗时

## Docker 部署

```bash
docker compose up -d
```

数据库文件挂载在 Docker 卷中，重启后调度配置和扫描水位不丢失。

## 开发验证

```bash
# 后端测试
cd server && npm test

# 后端 TypeScript 检查
cd server && npx tsc --noEmit

# 前端构建
cd client && npm run build

# Prisma schema 校验
cd server && npx prisma validate
```

## 项目结构

```
server/
  src/
    index.ts                 # 入口，注册路由和调度器
    services/scheduler.ts    # V2 定时调度器
    services/search.ts       # Bing/Google/HN/DuckDuckGo 来源
    services/chinaSearch.ts  # 搜狗/Bilibili/微博 来源
    services/twitter.ts      # Twitter 来源
    services/github.ts       # GitHub 来源
    services/ai.ts           # AI 分析
    services/email.ts        # 邮件通知
    jobs/hotspotChecker.ts   # 增量扫描核心逻辑
    routes/scheduler.ts      # 调度器 API
    routes/hotspots.ts       # 热点 API
    routes/keywords.ts       # 关键词 API
  prisma/schema.prisma       # 数据库模型
client/
  src/App.tsx                # 前端主页面
  src/services/api.ts        # API 客户端
```

## 文档

- [本地运行指南](docs/LOCAL_SETUP.md)
- [API 集成说明](docs/API_INTEGRATION.md)
- [V2 开发清单](docs/V2_DEVELOPMENT_CHECKLIST.md)

## License

MIT
