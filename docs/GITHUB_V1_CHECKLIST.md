# 第一版开发清单：GitHub AI 热点监控

> 状态：第一版已实现，待部署环境验收
> 日期：2026-09-24
> 本文定义第一版范围与验收要求，勾选项完成后应附上对应的验证结果。

实现记录：GitHub REST 采集、仓库/Release 数据模型、定时任务、手动搜索、前端展示、通知链路和文档已接入。服务端 95 个测试通过（22 个需要 OpenRouter Key 的评估用例跳过），前后端构建及前端 lint 通过；真实 `AI agent` 仓库搜索与 `repo:ollama/ollama` Release 采集验证通过。数据库迁移通过 `prisma migrate diff` 校验，实际部署需在本机可用的 SQLite/Prisma 引擎环境执行 `prisma migrate deploy`。

## 1. 版本目标

在现有热点监控项目中接入 GitHub，支持按关键词发现 AI 仓库、跟踪指定仓库的 Release，并复用现有 AI 分析、数据库、前端和通知流程。

第一版的“热点”指近期活跃且与监控关键词相关的仓库，以及新发布的 Release。总 Star、Fork 数用于辅助排序，不代表实时增长趋势。

## 2. 范围与约定

| 能力 | 第一版范围 |
| --- | --- |
| 关键词发现 | 使用 GitHub Search API 搜索近期活跃的公开仓库 |
| 指定仓库 | 使用明确的 `repo:owner/repo` 输入格式跟踪仓库，避免与普通关键词混淆 |
| Release 监控 | 获取指定仓库的近期 Release，标注预发布版本，不收录草稿 |
| 指标展示 | 仓库名称、Star、Fork、订阅人数、主要语言 |
| 热度排序 | 使用现有总量指标建立基础分数，与社交平台指标区分展示 |
| 通知 | 复用 WebSocket 和邮件；高重要性内容满足通知条件后发送邮件 |
| 调度 | 复用现有每 30 分钟检查和手动触发能力 |

以下能力放到后续版本：Star/Fork 增量快照、增长趋势榜、GitHub Trending 页面采集、Issues/PR/提交活动监控、小红书接入，以及跨平台新闻聚类。

## 3. 开发任务

### 3.1 GitHub 数据源

- [ ] 新增 `server/src/services/github.ts`。
- [ ] 封装 GitHub REST API 请求，统一请求头、超时和错误处理。
- [ ] 使用 `GET /search/repositories` 实现关键词搜索。
- [ ] 使用 `GET /repos/{owner}/{repo}` 获取指定仓库资料。
- [ ] 使用 `GET /repos/{owner}/{repo}/releases` 获取版本发布信息。
- [ ] 解析和校验 `repo:owner/repo` 格式。
- [ ] 获取仓库描述、链接、Star、Fork、主要语言和时间字段。
- [ ] 需要展示订阅人数时读取 `subscribers_count`，避免将 `watchers_count` 当成订阅人数。
- [ ] 支持可选的 `GITHUB_TOKEN`，仅通过服务端发送。
- [ ] 处理未认证访问、无效 Token、仓库不存在、超时、限流和服务异常。
- [ ] 遵循限流响应中的等待信息，限制重试次数，避免持续重试。
- [ ] 对适用的请求增加 ETag 条件请求，正确处理 `304`。
- [ ] 将采集结果转换成项目统一的数据结构。

### 3.2 数据结构与迁移

- [ ] 在 `SearchResult.source` 中增加 `github`。
- [ ] 增加 `eventType`：`release` 或 `repository`。
- [ ] 增加 `repoFullName`、`starCount`、`forkCount`、`watcherCount`、`language` 字段。
- [ ] 增加 Release 版本号和预发布标记，明确其存储方式。
- [ ] 保存 GitHub 原始条目 ID 和规范化链接。
- [ ] 在 `server/prisma/schema.prisma` 中扩展 `Hotspot`，新增字段允许为空以兼容历史数据。
- [ ] 添加数据库迁移并验证旧数据可以正常读取。
- [ ] 同步前后端类型定义和接口响应结构。
- [ ] 独立保存 GitHub 指标，不把 Star 填入点赞数，也不把 Issues 数当成评论数。

### 3.3 热点处理流程

- [ ] 将 GitHub 接入 `server/src/jobs/hotspotChecker.ts`。
- [ ] 普通关键词通过仓库搜索发现内容；指定仓库模式检查该仓库的 Release。
- [ ] 与其他来源并行采集，GitHub 失败不阻塞其他来源。
- [ ] 为 GitHub 分配合理的处理配额，避免被现有来源占满配额。
- [ ] 按稳定的条目 ID 或规范化链接去重，同一 Release 不重复入库。
- [ ] 已存在的仓库允许更新指标，但不因总 Star 变化反复发送新热点通知。
- [ ] Release 使用发布时间过滤；仓库使用最近推送时间判定活跃度，前端明确时间含义。
- [ ] 使用 Release 正文或仓库描述进行 AI 相关性、摘要和重要性分析。
- [ ] 指定仓库模式使用仓库名作为分析主题，不把 `repo:` 控制语法直接当成内容关键词。
- [ ] 将 Release 类型作为重要性判断信号，不把所有版本发布直接判定为高重要性。
- [ ] 增加基础 GitHub 热度计算，说明公式和指标含义。
- [ ] 统一卡片展示与列表排序使用的分数规则。
- [ ] 复用数据库保存、WebSocket 推送和邮件通知。

### 3.4 API 与前端

- [ ] 手动搜索支持 `sources: ["github"]`。
- [ ] 明确默认手动搜索是否包含 GitHub，并在页面提供可操作的选择入口。
- [ ] 统一手动搜索和已保存热点的响应格式，使 AI 分析、指标和作者信息可以正确显示。
- [ ] 来源筛选增加 GitHub。
- [ ] 增加 GitHub 图标和来源标签。
- [ ] 热点卡片展示仓库名称、Release/Repository 类型、Star、Fork 和语言。
- [ ] 展示 Release 版本号、预发布状态及原文链接。
- [ ] 仓库卡片区分“最近推送时间”和“发现时间”。
- [ ] 在监控词输入处提示 `repo:owner/repo` 用法。
- [ ] 对缺失指标、空结果和请求失败显示清晰提示。

### 3.5 配置与文档

- [ ] 更新 `server/.env.example`，增加 `GITHUB_TOKEN` 占位说明。
- [ ] 更新 `docs/LOCAL_SETUP.md`，说明 Token 配置和验证步骤。
- [ ] 更新 `docs/API_INTEGRATION.md`，记录 GitHub 接口和数据映射。
- [ ] 更新 README 的来源列表和使用示例。
- [ ] 说明公共仓库监控所需的最小权限，避免申请无关写权限。
- [ ] 说明匿名与认证请求的限额差异，实际行为以 GitHub 响应为准。
- [ ] 说明首次发现仓库的总 Star 不代表当日增长。

### 3.6 测试与验证

- [ ] 新增 GitHub 响应转换测试，覆盖仓库、Release、空正文和缺失字段。
- [ ] 测试指定仓库格式解析和非法输入。
- [ ] 测试同一 Release 重复采集不会重复保存或通知。
- [ ] 测试已收录仓库更新指标后不会重复发送新热点通知。
- [ ] 测试超时、认证失败、限流和 `304` 的处理。
- [ ] 测试 GitHub 接入 AI 过滤与通知链路的关键路径，使用模拟服务避免测试产生外部费用或真实邮件。
- [ ] 验证手动搜索结果与前端字段一致。
- [ ] 验证 GitHub 来源筛选、卡片展示和原文跳转。
- [ ] 后端现有测试与前后端构建通过。
- [ ] 使用 `AI agent` 完成一次真实仓库搜索验证。
- [ ] 使用 `repo:ollama/ollama` 等公开仓库完成 Release 采集验证；若近期无 Release，记录该结果并使用测试数据验证通知链路。

## 4. 主要文件

| 文件 | 预计改动 |
| --- | --- |
| `server/src/services/github.ts` | 新增采集和转换逻辑 |
| `server/src/types.ts` | 扩展来源和 GitHub 字段 |
| `server/prisma/schema.prisma` | 扩展热点模型 |
| `server/prisma/migrations/` | 新增数据库迁移 |
| `server/src/jobs/hotspotChecker.ts` | 接入采集、去重、指标更新和通知 |
| `server/src/routes/hotspots.ts` | 接入手动搜索并统一响应 |
| `server/src/utils/sortHotspots.ts` | 增加 GitHub 排序规则 |
| `server/src/__tests__/github.test.ts` | 新增 GitHub 核心测试 |
| `client/src/services/api.ts` | 同步接口类型 |
| `client/src/services/socket.ts` | 按需同步推送类型 |
| `client/src/components/FilterSortBar.tsx` | 增加来源选项 |
| `client/src/App.tsx` | 增加搜索入口提示和 GitHub 卡片信息 |
| `client/src/utils/sortHotspots.ts` | 与服务端排序保持一致 |
| `server/.env.example` | 增加 GitHub 配置说明 |
| `README.md`、`docs/LOCAL_SETUP.md`、`docs/API_INTEGRATION.md` | 更新配置、使用和接口文档 |

## 5. 建议实施顺序

1. 确认数据结构和响应约定，完成数据库迁移。
2. 实现 GitHub 请求、仓库搜索、指定仓库和 Release 采集。
3. 接入定时任务、去重、AI 分析与通知。
4. 完成手动搜索接口和前端展示。
5. 执行测试、构建及真实来源验证，补齐文档。

## 6. 第一版验收标准

- [ ] 输入 `AI agent` 可以查看相关的近期活跃公开仓库及其指标。
- [ ] 输入 `repo:owner/repo` 可以跟踪指定仓库的近期 Release。
- [ ] 同一 Release 连续采集两次只生成一条热点，不重复通知。
- [ ] 仓库 Star/Fork 指标变化可以更新，不误报为新的项目。
- [ ] GitHub 请求失败不会导致其他来源的采集失败。
- [ ] GitHub 内容可以经过 AI 分析、入库、展示和通知完整流程。
- [ ] 前端可以筛选 GitHub 来源，正确显示条目类型、指标及时间。
- [ ] 缺少 Token 时可尝试匿名访问；认证或限流异常具有可诊断信息。
- [ ] Token 不出现在前端响应、提交文件或日志中。
- [ ] 数据库迁移、测试、前后端构建及使用文档均完成验证。
