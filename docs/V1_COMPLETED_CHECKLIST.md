# 第一版已完成开发清单：GitHub AI 热点监控

> 版本：V1
> 完成日期：2026-09-27
> 用途：提供给下一版开发使用，说明第一版已经交付的能力、验证结果和明确的后续范围。

## 1. 第一版目标

第一版在现有热点监控系统中接入 GitHub，支持发现近期活跃的公开仓库、跟踪指定仓库的 Release，并复用已有的 AI 分析、SQLite/Prisma、WebSocket、邮件通知和定时检查流程。

## 2. 已完成的功能

### 2.1 GitHub 数据源

- [x] 新增 `server/src/services/github.ts`。
- [x] 使用 GitHub REST API 搜索仓库、读取仓库详情和读取 Release。
- [x] 普通关键词搜索近期活跃仓库，搜索条件包含最近推送时间窗口。
- [x] 支持 `repo:owner/repo` 格式；该格式只监控指定仓库的 Release。
- [x] 过滤草稿 Release，保留并标记预发布 Release。
- [x] 映射仓库名称、描述、链接、Star、Fork、订阅人数、主要语言和时间字段。
- [x] 订阅人数使用 `subscribers_count`，没有把 `watchers_count` 当作订阅人数。
- [x] 支持可选的 `GITHUB_TOKEN`，Token 只在服务端使用。
- [x] 统一处理请求头、超时、无效 Token、仓库不存在、网络失败和限流异常。
- [x] 限流时根据响应等待信息最多重试一次。
- [x] 支持 ETag 条件请求和 `304` 缓存响应。

### 2.2 数据结构与数据库

- [x] `SearchResult.source` 增加 `github`。
- [x] 增加 `eventType`，取值为 `repository` 或 `release`。
- [x] 增加 `repoFullName`、`starCount`、`forkCount`、`watcherCount`、`language`。
- [x] 增加 `releaseTagName`、`releaseIsPrerelease` 和 `pushedAt`。
- [x] 保存 GitHub 原始条目 ID，并使用来源和规范化 URL 去重。
- [x] `Hotspot` 增加可为空的 GitHub 字段，兼容历史热点数据。
- [x] 新增数据库迁移：`server/prisma/migrations/20260924090000_add_github_fields/`。
- [x] GitHub 指标独立保存，没有写入点赞、转发或评论字段。

### 2.3 采集、分析与通知流程

- [x] GitHub 与 Twitter、网页搜索、国内来源并行采集。
- [x] GitHub 采集失败不会阻塞其他来源。
- [x] 为 GitHub 设置独立处理配额。
- [x] 同一仓库或 Release 重复采集时不重复创建热点。
- [x] 已存在仓库可以更新 Star、Fork、订阅人数、语言和最近推送时间，不重复发送新热点通知。
- [x] Release 按发布时间处理，仓库按最近推送时间判断活跃度。
- [x] Release 正文或仓库描述进入 AI 相关性、摘要和重要性分析。
- [x] `repo:owner/repo` 分析时使用仓库名作为主题，不把控制语法作为内容关键词。
- [x] GitHub 热度分使用独立指标：

  `20 × log10(Star + 1) + 15 × log10(Fork + 1) + 5 × log10(订阅人数 + 1)`

- [x] 卡片展示和“热度综合”排序使用一致的指标规则。
- [x] 复用数据库保存、WebSocket 推送和高重要性邮件通知。

### 2.4 API 与前端

- [x] 手动搜索支持 `sources: ["github"]`。
- [x] 手动搜索默认包含 GitHub，并提供 Twitter、Bing、GitHub 来源开关。
- [x] 手动搜索与已保存热点使用统一字段结构。
- [x] 来源筛选增加 GitHub。
- [x] 增加 GitHub 图标和来源标签。
- [x] 卡片展示 Repository/Release 类型、仓库名、Release 版本、预发布状态、Star、Fork、订阅人数和语言。
- [x] 仓库展示“最近推送时间”和“发现时间”，Release 展示发布时间。
- [x] 监控词和搜索框提示 `repo:owner/repo` 用法。
- [x] 对空结果、缺失指标和 GitHub 请求失败提供提示。
- [x] `localhost:3001` 提供 API 状态信息和 `/api/health` 健康检查。

### 2.5 Docker 与运行环境

- [x] 新增后端和前端 Dockerfile。
- [x] 新增 Nginx 静态文件、API 和 Socket.io 反向代理配置。
- [x] 新增 `docker-compose.yml`，包含后端、前端和 SQLite 持久化卷。
- [x] 后端容器启动时自动执行 Prisma migration 和 client generate。
- [x] 已从远程仓库代码完成本地 Docker 构建和启动验证。
- [x] 已验证前端页面、后端根路由和前端代理健康检查。

### 2.6 配置与文档

- [x] `server/.env.example` 增加 `GITHUB_TOKEN` 和超时配置说明。
- [x] `docs/LOCAL_SETUP.md` 增加 Token、权限和 Docker Compose 使用说明。
- [x] `docs/API_INTEGRATION.md` 增加 GitHub API、字段映射和热度公式说明。
- [x] README 和项目来源列表增加 GitHub 使用示例。
- [x] 说明公开仓库只需要读取权限、匿名和认证限额差异，以及 Star/Fork 不代表当日增长。

## 3. 测试与验收结果

- [x] GitHub 仓库和 Release 响应转换测试通过。
- [x] 空 Release 正文、缺失字段和预发布状态测试通过。
- [x] `repo:owner/repo` 合法和非法格式测试通过。
- [x] ETag/304 和限流重试测试通过。
- [x] GitHub 指标热度计算测试通过。
- [x] 服务端测试通过：96 个测试通过，22 个需要 OpenRouter Key 的 AI 评估用例跳过。
- [x] 服务端 TypeScript 构建通过。
- [x] 前端 TypeScript/Vite 构建通过。
- [x] 前端 ESLint 检查通过。
- [x] Prisma schema 校验和 migration diff 校验通过。
- [x] 真实 `AI agent` GitHub 仓库搜索验证通过。
- [x] 真实 `repo:ollama/ollama` Release 采集验证通过。
- [x] Docker 容器健康检查通过：后端和前端均可访问，前端 `/api/health` 代理正常。

## 4. 第一版明确不包含的能力

以下内容留给后续版本，不应在下一版开始时误认为第一版缺陷：

- Star/Fork 增量快照和增长趋势榜。
- GitHub Trending 页面采集。
- Issues、Pull Requests 和提交活动监控。
- 小红书数据源。
- 跨平台新闻聚类和更复杂的实体合并。
- 多用户、权限管理和云端部署。

## 5. 下一版开发注意事项

- 继续沿用 `repo:owner/repo` 作为指定仓库控制语法，避免与普通关键词混淆。
- GitHub Star、Fork 和订阅人数必须继续保存在独立字段中，不要复用社交平台互动字段。
- 新增 GitHub API 请求时保留服务端 Token 隔离、超时、限流和 ETag 处理。
- 新增数据库字段时保持可为空，并提供 Prisma migration。
- 任何新的排序或热度指标都要同时更新服务端、前端和测试。
- 当前本地 Docker 部署因宿主机 5173 端口占用使用 `docker-compose.local.yml` 映射到 5174；正式部署可释放 5173 后使用默认 Compose 配置。

## 6. 主要实现文件

| 文件 | 用途 |
| --- | --- |
| `server/src/services/github.ts` | GitHub 请求、解析、转换和错误处理 |
| `server/src/jobs/hotspotChecker.ts` | 定时采集、去重、指标更新、AI 和通知链路 |
| `server/src/routes/hotspots.ts` | 热点查询和手动搜索接口 |
| `server/src/routes/keywords.ts` | 监控词格式校验 |
| `server/prisma/schema.prisma` | GitHub 字段模型 |
| `server/src/__tests__/github.test.ts` | GitHub 单元测试 |
| `client/src/App.tsx` | GitHub 卡片、搜索入口和指标展示 |
| `client/src/utils/sortHotspots.ts` | 前端热度排序 |
| `server/src/utils/sortHotspots.ts` | 后端热度排序 |
| `docker-compose.yml` | 本地容器编排 |

