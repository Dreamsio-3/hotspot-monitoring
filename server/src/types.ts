export interface SearchResult {
  title: string;
  content: string;
  url: string;
  source: 'twitter' | 'bing' | 'google' | 'duckduckgo' | 'hackernews' | 'sogou' | 'bilibili' | 'weibo' | 'github';
  sourceId?: string;
  eventType?: 'release' | 'repository';
  repoFullName?: string;
  starCount?: number;
  forkCount?: number;
  watcherCount?: number;
  language?: string;
  releaseTagName?: string;
  releaseIsPrerelease?: boolean;
  pushedAt?: Date;
  publishedAt?: Date;
  viewCount?: number;
  likeCount?: number;
  retweetCount?: number;
  replyCount?: number; // Twitter 回复数
  quoteCount?: number; // Twitter 引用数
  score?: number; // Hacker News score
  commentCount?: number; // Hacker News / Bilibili comments
  danmakuCount?: number; // Bilibili 弹幕数
  author?: {
    name: string;
    username?: string;
    avatar?: string;
    followers?: number;
    verified?: boolean;
  };
}

// Twitter 质量过滤配置
export interface TwitterFilterConfig {
  minLikes: number;
  minRetweets: number;
  minViews: number;
  minFollowers: number;
  onlyOriginalTweets: boolean; // 过滤回复和引用
}

export interface AIAnalysis {
  isReal: boolean;
  relevance: number;
  relevanceReason: string; // AI 判断相关性的理由
  keywordMentioned: boolean; // 内容中是否直接提及了关键词或其核心概念
  importance: 'low' | 'medium' | 'high' | 'urgent';
  summary: string; // 与关键词的关联说明（不是单纯的内容介绍）
}

export interface HotspotWithKeyword {
  id: string;
  title: string;
  content: string;
  url: string;
  source: string;
  sourceId: string | null;
  eventType: string | null;
  repoFullName: string | null;
  starCount: number | null;
  forkCount: number | null;
  watcherCount: number | null;
  language: string | null;
  releaseTagName: string | null;
  releaseIsPrerelease: boolean | null;
  pushedAt: Date | null;
  isReal: boolean;
  relevance: number;
  relevanceReason: string | null;
  keywordMentioned: boolean | null;
  importance: string;
  summary: string | null;
  viewCount: number | null;
  likeCount: number | null;
  retweetCount: number | null;
  replyCount: number | null;
  commentCount: number | null;
  quoteCount: number | null;
  danmakuCount: number | null;
  authorName: string | null;
  authorUsername: string | null;
  authorAvatar: string | null;
  authorFollowers: number | null;
  authorVerified: boolean | null;
  publishedAt: Date | null;
  createdAt: Date;
  keywordId: string | null;
  keyword: {
    id: string;
    text: string;
    category: string | null;
  } | null;
}

export interface Tweet {
  type: string;
  id: string;
  url: string;
  text: string;
  retweetCount: number;
  replyCount: number;
  likeCount: number;
  quoteCount: number;
  viewCount: number;
  createdAt: string;
  lang: string;
  author: {
    userName: string;
    name: string;
    isBlueVerified: boolean;
    profilePicture: string;
    followers: number;
  };
}

export interface TwitterSearchResponse {
  tweets: Tweet[];
  has_next_page: boolean;
  next_cursor: string;
}

// ============================================================
// V2: 来源、调度器和增量扫描类型
// ============================================================

/** V2 默认监控来源集合 */
export const V2_SOURCES = [
  'twitter', 'bing', 'google', 'sogou', 'weibo',
  'github', 'hackernews', 'bilibili'
] as const;

export type V2Source = (typeof V2_SOURCES)[number];

/** 统一来源适配器：每个来源实现此签名 */
export type SourceAdapter = (keyword: string) => Promise<SearchResult[]>;

/** 调度器配置（对应 SchedulerState 模型） */
export interface SchedulerConfig {
  enabled: boolean;
  intervalMinutes: number;
}

/** 调度器运行状态（GET /api/scheduler/status 响应） */
export interface SchedulerStatus {
  enabled: boolean;
  intervalMinutes: number;
  running: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastRunStatus: string | null;
  lastRunError: string | null;
  lastRunSummary: ScanRunSummary | null;
  activeKeywordCount: number;
}

/** 单次扫描运行摘要 */
export interface ScanRunSummary {
  keywordCount: number;
  newCount: number;
  updatedCount: number;
  filteredCount: number;
  sourceStats: Record<string, SourceScanStats>;
  durationMs: number;
}

/** 单个来源的扫描统计 */
export interface SourceScanStats {
  resultCount: number;
  newCount: number;
  updatedCount: number;
  filteredCount: number;
  durationMs: number;
  error?: string;
}

/** 允许的扫描间隔（分钟） */
export const ALLOWED_INTERVALS = [5, 10, 15, 30, 60] as const;
