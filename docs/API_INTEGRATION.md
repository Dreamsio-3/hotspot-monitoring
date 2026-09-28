# API 集成技术文档

## 来源采集

### 来源一览

| 来源 | 函数 | 文件 | 频率限制 | 需要 Key |
|------|------|------|----------|----------|
| Twitter | `searchTwitter` | `services/twitter.ts` | API 限额 | ✅ `TWITTER_API_KEY` |
| Bing | `searchBing` | `services/search.ts` | 5s / 请求 | ❌ |
| Google | `searchGoogle` | `services/search.ts` | 10s / 请求 | ❌ |
| Hacker News | `searchHackerNews` | `services/search.ts` | 1s / 请求 | ❌ |
| 搜狗 | `searchSogou` | `services/chinaSearch.ts` | 3s / 请求 | ❌ |
| Bilibili | `searchBilibili` | `services/chinaSearch.ts` | 2s / 请求 | ❌ |
| 微博 | `searchWeibo` | `services/chinaSearch.ts` | 3s / 请求 | ❌ |
| GitHub | `collectGitHub` | `services/github.ts` | API 限额 | 可选 `GITHUB_TOKEN` |

所有来源统一返回 `SearchResult[]` 类型，定义在 `types.ts`。

### 字段映射

每个来源的结果映射到 `SearchResult` 的核心字段：

- `title` — 标题
- `content` — 正文 / 描述
- `url` — 规范化链接
- `source` — 来源标识（如 `twitter`、`bing`）
- `sourceId` — 来源侧唯一 ID（用于稳定去重）
- `publishedAt` — 发布时间（部分来源无此字段）
- 互动指标：`viewCount`、`likeCount`、`retweetCount`、`commentCount` 等

### 错误语义

- 来源函数返回空数组 `[]` 表示无结果或请求失败
- 每个来源内置 `RateLimiter`，超时默认 15s
- 页面抓取来源（Bing/Google/搜狗）可能遇到验证码、结构变化或地区差异
- 失败时降级为空结果，错误信息记录到 `KeywordScanState.lastError`

### 增量策略

- 有 `publishedAt` 的来源：使用 `watermarkAt - 5min` 作为过滤起点，避免漏采
- 无 `publishedAt` 的搜索引擎结果：依赖 URL 规范化 + `sourceId` + 数据库唯一约束去重
- 已存在的热点只更新指标（viewCount、starCount 等），不重复 AI 分析和通知
- 扫描失败不推进 `watermarkAt`，下次重试

## 调度器 API

### GET /api/scheduler/status

返回调度器当前状态：

```json
{
  "enabled": true,
  "intervalMinutes": 30,
  "running": false,
  "lastRunAt": "2026-09-27T10:00:00.000Z",
  "nextRunAt": "2026-09-27T10:30:00.000Z",
  "lastRunStatus": "success",
  "lastRunError": null,
  "lastRunSummary": {
    "keywordCount": 3,
    "newCount": 5,
    "updatedCount": 12,
    "filteredCount": 8,
    "sourceStats": { ... },
    "durationMs": 45000
  },
  "activeKeywordCount": 3
}
```

### PUT /api/scheduler/config

更新调度器配置：

```json
{ "enabled": true, "intervalMinutes": 15 }
```

`intervalMinutes` 必须是 5、10、15、30、60 之一。

### POST /api/scheduler/trigger

手动触发一次增量扫描。如果已有任务在运行，返回 409。

### GET /api/scheduler/runs?limit=10

返回最近的扫描运行记录。

## 热点 API

### GET /api/hotspots

默认只返回启用关键词（`keyword.isActive = true`）关联的热点。支持以下查询参数：

- `page` / `limit` — 分页
- `source` — 来源筛选
- `importance` — 重要程度筛选
- `keywordId` — 关键词筛选
- `timeRange` — 时间范围（1h / today / 7d / 30d）
- `sortBy` — 排序字段（hot / createdAt / publishedAt / relevance / importance）
- `sortOrder` — 排序方向（asc / desc）

### GET /api/hotspots/stats

统计使用同一启用关键词过滤条件。

### POST /api/hotspots/search — 已下线

返回 410 Gone。V2 不再提供手动搜索功能。

## AI 分析

使用 OpenRouter 接入 AI 模型，对每条新内容进行：

- 真实性判断（`isReal`）
- 相关性评分（`relevance` 0-100）
- 关键词是否直接提及（`keywordMentioned`）
- 重要程度评估（`importance`）
- 智能摘要（`summary`）

过滤规则：
- `isReal = false` 直接过滤
- `relevance < 50` 过滤
- 未直接提及关键词且 `relevance < 65` 过滤

## GitHub 集成

- 普通关键词搜索近期活跃仓库
- `repo:owner/repo` 语法跟踪指定仓库 Release
- 字段映射：`starCount`、`forkCount`、`watcherCount`（对应 `subscribers_count`）
- 热度公式：`20×log10(Star+1) + 15×log10(Fork+1) + 5×log10(订阅+1)`
- 可选 `GITHUB_TOKEN` 提高 API 限额
