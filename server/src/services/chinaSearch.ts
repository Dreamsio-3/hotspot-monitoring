import axios from 'axios';
import * as cheerio from 'cheerio';
import crypto from 'crypto';
import type { SearchResult } from '../types.js';

// User Agent 列表
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
];

// 频率限制器
class RateLimiter {
  private lastRequestTime = 0;
  private minInterval: number;

  constructor(minIntervalMs: number = 5000) {
    this.minInterval = minIntervalMs;
  }

  async wait(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestTime;
    if (elapsed < this.minInterval) {
      await new Promise(resolve => setTimeout(resolve, this.minInterval - elapsed));
    }
    this.lastRequestTime = Date.now();
  }
}

const sogouLimiter = new RateLimiter(3000);
const bilibiliLimiter = new RateLimiter(2000);
const weiboLimiter = new RateLimiter(3000);

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ============================================================
// 搜狗搜索（替代百度，反爬更宽松，无需 API Key）
// ============================================================
export async function searchSogou(query: string): Promise<SearchResult[]> {
  await sogouLimiter.wait();

  try {
    const response = await axios.get('https://www.sogou.com/web', {
      params: {
        query,
        ie: 'utf-8'
      },
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      },
      timeout: 15000,
      maxRedirects: 5
    });

    const $ = cheerio.load(response.data);
    const results: SearchResult[] = [];

    // 搜狗搜索结果解析
    $('.vrwrap, .rb').each((_, element) => {
      const titleElement = $(element).find('h3 a, .vr-title a, .vrTitle a').first();
      const title = titleElement.text().trim();
      let url = titleElement.attr('href') || '';

      // 搜狗的相对路径转绝对路径
      if (url.startsWith('/link?url=')) {
        url = `https://www.sogou.com${url}`;
      }

      const snippet = $(element).find('.space-txt, .str-text-info, .str_info, .text-layout').text().trim()
        || $(element).find('p').first().text().trim();

      // 排除广告和无关结果
      if (title && url && !title.includes('大家还在搜')) {
        results.push({
          title,
          content: snippet || title,
          url,
          source: 'sogou' as const
        });
      }
    });

    console.log(`Sogou search for "${query}": found ${results.length} results`);
    return results;
  } catch (error) {
    console.error('Sogou search error:', error instanceof Error ? error.message : error);
    return [];
  }
}

// ============================================================
// Bilibili 搜索（公开 API，无需 API Key）
// ============================================================

interface BilibiliSearchResponse {
  code: number;
  data?: {
    result?: BilibiliVideoResult[];
  };
}

interface BilibiliVideoResult {
  aid: number;
  bvid: string;
  title: string;
  description: string;
  author: string;
  mid: number;
  pic: string;
  play: number;
  favorites: number;
  review: number; // 评论数
  danmaku: number;
  like: number;
  pubdate: number;
  tag: string;
}

interface BilibiliUserSearchResponse {
  code: number;
  data?: {
    result?: BilibiliUserResult[];
  };
}

interface BilibiliUserResult {
  mid: number;
  uname: string;
  usign: string;
  fans: number;
  videos: number;
  upic: string;
  official_verify: {
    type: number; // -1=无认证, 0=个人认证, 1=机构认证
    desc: string;
  };
}

interface BilibiliSpaceResponse {
  code: number;
  data?: {
    list?: {
      vlist?: BilibiliSpaceVideo[];
    };
  };
}

interface BilibiliSpaceVideo {
  aid: number;
  bvid: string;
  title: string;
  description: string;
  author: string;
  mid: number;
  pic: string;
  play: number;
  favorites: number;
  review: number;
  comment: number;
  danmaku: number;
  created: number;
}

// 搜索 Bilibili 视频
export async function searchBilibili(query: string): Promise<SearchResult[]> {
  await bilibiliLimiter.wait();

  try {
    // 生成 buvid3 cookie 以避免 412 错误
    const buvid3 = `${crypto.randomUUID()}infoc`;

    const response = await axios.get<BilibiliSearchResponse>(
      'https://api.bilibili.com/x/web-interface/search/type',
      {
        params: {
          keyword: query,
          search_type: 'video',
          order: 'pubdate', // 按发布时间排序，确保获取最新内容
          page: 1,
          pagesize: 20
        },
        headers: {
          'User-Agent': getRandomUserAgent(),
          'Referer': 'https://search.bilibili.com/',
          'Accept': 'application/json',
          'Cookie': `buvid3=${buvid3}`
        },
        timeout: 15000
      }
    );

    if (response.data.code !== 0 || !response.data.data?.result) {
      console.log(`Bilibili search: no results or API error (code: ${response.data.code})`);
      return [];
    }

    const results: SearchResult[] = response.data.data.result.map(video => ({
      title: video.title.replace(/<\/?em[^>]*>/g, ''), // 去掉高亮标签
      content: video.description || video.title.replace(/<\/?em[^>]*>/g, ''),
      url: `https://www.bilibili.com/video/${video.bvid}`,
      source: 'bilibili' as const,
      sourceId: video.bvid,
      publishedAt: new Date(video.pubdate * 1000),
      viewCount: video.play,
      likeCount: video.like,
      commentCount: video.review,
      danmakuCount: video.danmaku,
      author: {
        name: video.author,
        username: String(video.mid)
      }
    }));

    console.log(`Bilibili search for "${query}": found ${results.length} results`);
    return results;
  } catch (error) {
    console.error('Bilibili search error:', error instanceof Error ? error.message : error);
    return [];
  }
}

// 搜索 Bilibili 用户（用于账号检测）
export async function searchBilibiliUser(keyword: string): Promise<BilibiliUserResult | null> {
  await bilibiliLimiter.wait();

  try {
    const response = await axios.get<BilibiliUserSearchResponse>(
      'https://api.bilibili.com/x/web-interface/search/type',
      {
        params: {
          keyword,
          search_type: 'bili_user',
          page: 1,
          pagesize: 5
        },
        headers: {
          'User-Agent': getRandomUserAgent(),
          'Referer': 'https://search.bilibili.com/',
          'Accept': 'application/json'
        },
        timeout: 15000
      }
    );

    if (response.data.code !== 0 || !response.data.data?.result?.length) {
      return null;
    }

    // 找到名字精确匹配或高度匹配的用户
    const exactMatch = response.data.data.result.find(
      user => user.uname === keyword || user.uname.toLowerCase() === keyword.toLowerCase()
    );

    if (exactMatch) {
      return exactMatch;
    }

    // 如果第一个结果粉丝数较高且名字包含关键词，也认为是匹配
    const topResult = response.data.data.result[0];
    if (topResult.fans > 1000 && topResult.uname.includes(keyword)) {
      return topResult;
    }

    return null;
  } catch (error) {
    console.error('Bilibili user search error:', error instanceof Error ? error.message : error);
    return null;
  }
}

// 获取 B 站用户最新视频
export async function getBilibiliUserVideos(mid: number): Promise<SearchResult[]> {
  await bilibiliLimiter.wait();

  try {
    const response = await axios.get<BilibiliSpaceResponse>(
      'https://api.bilibili.com/x/space/arc/search',
      {
        params: {
          mid,
          pn: 1,
          ps: 10,
          order: 'pubdate' // 按发布时间排序
        },
        headers: {
          'User-Agent': getRandomUserAgent(),
          'Referer': `https://space.bilibili.com/${mid}`,
          'Accept': 'application/json'
        },
        timeout: 15000
      }
    );

    if (response.data.code !== 0 || !response.data.data?.list?.vlist) {
      return [];
    }

    const results: SearchResult[] = response.data.data.list.vlist.map(video => ({
      title: video.title,
      content: video.description || video.title,
      url: `https://www.bilibili.com/video/${video.bvid}`,
      source: 'bilibili' as const,
      sourceId: video.bvid,
      publishedAt: new Date(video.created * 1000),
      viewCount: video.play,
      commentCount: video.comment || video.review,
      danmakuCount: video.danmaku,
      author: {
        name: video.author,
        username: String(video.mid)
      }
    }));

    console.log(`Bilibili user ${mid} videos: found ${results.length} results`);
    return results;
  } catch (error) {
    console.error('Bilibili user videos error:', error instanceof Error ? error.message : error);
    return [];
  }
}

// ============================================================
// 微博热搜（公开API，无需登录，无需API Key）
// 通过热搜榜匹配关键词，判断话题是否在微博上热门
// ============================================================

interface WeiboHotItem {
  word: string;
  note?: string;
  num: number;
  category?: string;
  mid?: string;
  raw_hot?: number;
}

export async function searchWeibo(query: string): Promise<SearchResult[]> {
  await weiboLimiter.wait();

  try {
    // 使用微博热搜公开 API（无需登录）
    const response = await axios.get('https://weibo.com/ajax/side/hotSearch', {
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'application/json',
        'Referer': 'https://weibo.com/'
      },
      timeout: 15000
    });

    if (response.data?.ok !== 1 || !response.data?.data?.realtime) {
      console.log('Weibo hot search: no data or API error');
      return [];
    }

    const hotItems: WeiboHotItem[] = response.data.data.realtime;
    const results: SearchResult[] = [];
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 0);

    for (const item of hotItems) {
      const word = (item.note || item.word || '').toLowerCase();
      
      // 检查关键词是否匹配热搜话题（任一查询词出现在话题中，或话题出现在查询中）
      const isMatch = queryWords.some(qw => word.includes(qw) || qw.includes(word))
        || word.includes(queryLower)
        || queryLower.includes(word);

      if (isMatch) {
        const topicName = item.note || item.word;
        const url = `https://s.weibo.com/weibo?q=${encodeURIComponent('#' + topicName + '#')}`;

        results.push({
          title: `🔥 微博热搜: ${topicName}`,
          content: `微博热搜话题「${topicName}」，热度 ${item.num?.toLocaleString() || '未知'}`,
          url,
          source: 'weibo' as const,
          viewCount: item.num || 0
        });
      }
    }

    // 如果没有匹配的热搜，返回所有热搜中的前几条作为参考（对于热点监控有价值）
    if (results.length === 0) {
      console.log(`Weibo hot search: no match for "${query}", returning top trends`);
    } else {
      console.log(`Weibo hot search: ${results.length} matches for "${query}"`);
    }

    return results;
  } catch (error) {
    console.error('Weibo hot search error:', error instanceof Error ? error.message : error);
    return [];
  }
}

// ============================================================
// 账号检测与信息获取
// ============================================================

export interface AccountInfo {
  platform: 'bilibili' | 'weibo';
  name: string;
  id: string;
  followers: number;
  verified: boolean;
  description: string;
  avatar?: string;
}

// 检测关键词是否为某平台账号，并获取该账号最新内容
export async function detectAndFetchAccount(keyword: string): Promise<{
  accounts: AccountInfo[];
  results: SearchResult[];
}> {
  const accounts: AccountInfo[] = [];
  const results: SearchResult[] = [];

  // 并行检测 Bilibili 用户
  try {
    const biliUser = await searchBilibiliUser(keyword);
    if (biliUser) {
      accounts.push({
        platform: 'bilibili',
        name: biliUser.uname,
        id: String(biliUser.mid),
        followers: biliUser.fans,
        verified: biliUser.official_verify?.type >= 0,
        description: biliUser.usign,
        avatar: biliUser.upic
      });

      console.log(`🎯 Detected Bilibili account: ${biliUser.uname} (${biliUser.fans} fans)`);

      // 获取该用户最新视频
      const userVideos = await getBilibiliUserVideos(biliUser.mid);
      results.push(...userVideos);
    }
  } catch (error) {
    console.error('Bilibili account detection error:', error instanceof Error ? error.message : error);
  }

  return { accounts, results };
}

// ============================================================
// 国内聚合搜索
// ============================================================
export async function searchAllChina(query: string): Promise<SearchResult[]> {
  const results = await Promise.allSettled([
    searchSogou(query),
    searchBilibili(query),
    searchWeibo(query)
  ]);

  const allResults: SearchResult[] = [];
  const sourceNames = ['Sogou', 'Bilibili', 'Weibo'];
  
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      allResults.push(...result.value);
      console.log(`  ${sourceNames[index]}: ${result.value.length} results`);
    } else {
      console.warn(`  ${sourceNames[index]} search failed:`, result.reason);
    }
  });

  return allResults;
}
