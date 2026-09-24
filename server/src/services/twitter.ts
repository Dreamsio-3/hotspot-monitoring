import type { SearchResult, Tweet, TwitterSearchResponse, TwitterFilterConfig } from '../types.js';

const TWITTER_API_BASE = 'https://api.twitterapi.io';

// 质量过滤阈值（按用户方案设定）
export const TWITTER_FILTER_CONFIG: TwitterFilterConfig = {
  minLikes: 10,
  minRetweets: 5,
  minViews: 500,
  minFollowers: 100,
  onlyOriginalTweets: true
};

// ============================================================
// 质量过滤 & 排序
//   1. 排除回复推文（type 包含 reply 或以 @ 开头）
//   2. 最低指标过滤（蓝V 用户阈值减半）
//   3. 按质量评分排序
// ============================================================
function filterAndRankTweets(tweets: Tweet[]): Tweet[] {
  const { minLikes, minRetweets, minViews, minFollowers } = TWITTER_FILTER_CONFIG;

  const filtered = tweets.filter(tweet => {
    // 排除回复推文：检查 type 字段 + 文本是否以 @用户名 开头
    if (tweet.type && tweet.type.toLowerCase().includes('reply')) return false;
    if (/^@\w+\s/.test(tweet.text.trim())) return false;

    // 蓝V 用户阈值减半
    const factor = tweet.author.isBlueVerified ? 0.5 : 1;

    if (tweet.likeCount < minLikes * factor) return false;
    if (tweet.retweetCount < minRetweets * factor) return false;
    if (tweet.viewCount < minViews * factor) return false;
    if (tweet.author.followers < minFollowers * factor) return false;

    return true;
  });

  // 质量评分排序：likes*2 + retweets*3 + views/100 + 蓝V加权
  filtered.sort((a, b) => {
    const scoreA = a.likeCount * 2 + a.retweetCount * 3 + a.viewCount / 100 + (a.author.isBlueVerified ? 50 : 0);
    const scoreB = b.likeCount * 2 + b.retweetCount * 3 + b.viewCount / 100 + (b.author.isBlueVerified ? 50 : 0);
    return scoreB - scoreA;
  });

  return filtered;
}

// ============================================================
// 日期工具
// ============================================================
function formatSinceDate(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// ============================================================
// 构建高级搜索 query
//   - Top 搜索：近 7 天，min_faves:10，排除 RT 和纯回复
//   - Latest 搜索：近 3 天，排除 RT 和纯回复
// 参考语法：https://github.com/igorbrigadir/twitter-advanced-search
// ============================================================
function buildAdvancedQuery(keyword: string, type: 'Top' | 'Latest'): string {
  const parts: string[] = [keyword];

  // 排除 RT 和纯回复
  parts.push('-filter:retweets');
  parts.push('-filter:replies');

  // 时间范围：Top 看 7 天，Latest 看 3 天
  const daysAgo = type === 'Top' ? 7 : 3;
  parts.push(`since:${formatSinceDate(daysAgo)}`);

  // Top 搜索额外加 min_faves 保证质量
  if (type === 'Top') {
    parts.push('min_faves:10');
  }

  return parts.join(' ');
}

// ============================================================
// HTTP 请求
// ============================================================
async function makeTwitterRequest(endpoint: string, params: Record<string, string> = {}): Promise<any> {
  const apiKey = process.env.TWITTER_API_KEY;

  if (!apiKey) {
    console.warn('Twitter API key not configured');
    return { tweets: [] };
  }

  const url = new URL(`${TWITTER_API_BASE}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, value);
  });

  const response = await fetch(url.toString(), {
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Twitter API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// ============================================================
// 获取单页推文（支持分页）
// ============================================================
async function fetchTweetPage(
  query: string,
  queryType: 'Top' | 'Latest',
  cursor?: string
): Promise<{ tweets: Tweet[]; nextCursor?: string }> {
  const data = await makeTwitterRequest('/twitter/tweet/advanced_search', {
    query,
    queryType,
    ...(cursor ? { cursor } : {})
  }) as TwitterSearchResponse;

  return {
    tweets: data.tweets && Array.isArray(data.tweets) ? data.tweets : [],
    nextCursor: data.has_next_page ? data.next_cursor : undefined
  };
}

// ============================================================
// 主搜索函数
//   Top: 拉取 2 页（≤40 条高质量热门推文）
//   Latest: 拉取 1 页（≤20 条最新推文）
// ============================================================
export async function searchTwitter(query: string): Promise<SearchResult[]> {
  try {
    const topQuery = buildAdvancedQuery(query, 'Top');
    const latestQuery = buildAdvancedQuery(query, 'Latest');

    console.log(`Twitter advanced queries:\n  Top: ${topQuery}\n  Latest: ${latestQuery}`);

    // 第 1 批：Top 第 1 页 + Latest 第 1 页（并行）
    const [topPage1, latestPage1] = await Promise.allSettled([
      fetchTweetPage(topQuery, 'Top'),
      fetchTweetPage(latestQuery, 'Latest')
    ]);

    const allTweets: Tweet[] = [];
    const seenIds = new Set<string>();

    const addTweets = (tweets: Tweet[]) => {
      for (const tweet of tweets) {
        if (!seenIds.has(tweet.id)) {
          seenIds.add(tweet.id);
          allTweets.push(tweet);
        }
      }
    };

    let topNextCursor: string | undefined;

    if (topPage1.status === 'fulfilled') {
      addTweets(topPage1.value.tweets);
      topNextCursor = topPage1.value.nextCursor;
    }
    if (latestPage1.status === 'fulfilled') {
      addTweets(latestPage1.value.tweets);
    }

    // 第 2 批：如果 Top 有下一页，再拉一页（多拿一些热门内容）
    if (topNextCursor) {
      try {
        const topPage2 = await fetchTweetPage(topQuery, 'Top', topNextCursor);
        addTweets(topPage2.tweets);
      } catch (e) {
        console.warn('Twitter Top page 2 failed:', e);
      }
    }

    console.log(`Twitter: ${allTweets.length} unique tweets fetched (Top 2 pages + Latest 1 page)`);

    // 本地质量过滤 & 排序
    const qualityTweets = filterAndRankTweets(allTweets);
    console.log(`Twitter: ${allTweets.length} → ${qualityTweets.length} after quality filter (likes≥${TWITTER_FILTER_CONFIG.minLikes}, RT≥${TWITTER_FILTER_CONFIG.minRetweets}, views≥${TWITTER_FILTER_CONFIG.minViews}, followers≥${TWITTER_FILTER_CONFIG.minFollowers}, no replies)`);

    return qualityTweets.map((tweet: Tweet) => ({
      title: tweet.text.slice(0, 100),
      content: tweet.text,
      url: tweet.url,
      source: 'twitter' as const,
      sourceId: tweet.id,
      publishedAt: new Date(tweet.createdAt),
      viewCount: tweet.viewCount,
      likeCount: tweet.likeCount,
      retweetCount: tweet.retweetCount,
      replyCount: tweet.replyCount,
      quoteCount: tweet.quoteCount,
      author: {
        name: tweet.author.name,
        username: tweet.author.userName,
        avatar: tweet.author.profilePicture,
        followers: tweet.author.followers,
        verified: tweet.author.isBlueVerified
      }
    }));
  } catch (error) {
    console.error('Twitter search error:', error);
    return [];
  }
}

export async function getTrends(woeid: number = 1): Promise<any[]> {
  try {
    const data = await makeTwitterRequest('/twitter/trends', { woeid: String(woeid) });
    return data.trends || [];
  } catch (error) {
    console.error('Error fetching trends:', error);
    return [];
  }
}

export async function getUserTweets(username: string): Promise<SearchResult[]> {
  try {
    const data = await makeTwitterRequest('/twitter/user/last_tweets', {
      userName: username
    });

    if (!data.tweets || !Array.isArray(data.tweets)) {
      return [];
    }

    return data.tweets.map((tweet: Tweet) => ({
      title: tweet.text.slice(0, 100),
      content: tweet.text,
      url: tweet.url,
      source: 'twitter' as const,
      sourceId: tweet.id,
      publishedAt: new Date(tweet.createdAt),
      viewCount: tweet.viewCount,
      likeCount: tweet.likeCount,
      retweetCount: tweet.retweetCount,
      replyCount: tweet.replyCount,
      quoteCount: tweet.quoteCount,
      author: {
        name: tweet.author.name,
        username: tweet.author.userName,
        avatar: tweet.author.profilePicture,
        followers: tweet.author.followers,
        verified: tweet.author.isBlueVerified
      }
    }));
  } catch (error) {
    console.error('Error fetching user tweets:', error);
    return [];
  }
}
