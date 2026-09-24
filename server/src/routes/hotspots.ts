import { Router } from 'express';
import { prisma } from '../db.js';
import { sortHotspots } from '../utils/sortHotspots.js';
import type { AIAnalysis, SearchResult } from '../types.js';

const router = Router();

function toSearchHotspot(item: SearchResult, analysis: AIAnalysis | null) {
  return {
    id: `${item.source}:${item.sourceId || item.url}`,
    title: item.title,
    content: item.content,
    url: item.url,
    source: item.source,
    sourceId: item.sourceId || null,
    eventType: item.eventType || null,
    repoFullName: item.repoFullName || null,
    starCount: item.starCount ?? null,
    forkCount: item.forkCount ?? null,
    watcherCount: item.watcherCount ?? null,
    language: item.language || null,
    releaseTagName: item.releaseTagName || null,
    releaseIsPrerelease: item.releaseIsPrerelease ?? null,
    pushedAt: item.pushedAt?.toISOString() || null,
    isReal: analysis?.isReal ?? true,
    relevance: analysis?.relevance ?? 0,
    relevanceReason: analysis?.relevanceReason || null,
    keywordMentioned: analysis?.keywordMentioned ?? null,
    importance: analysis?.importance || 'low',
    summary: analysis?.summary || null,
    viewCount: item.viewCount ?? null,
    likeCount: item.likeCount ?? null,
    retweetCount: item.retweetCount ?? null,
    replyCount: item.replyCount ?? null,
    commentCount: item.commentCount ?? null,
    quoteCount: item.quoteCount ?? null,
    danmakuCount: item.danmakuCount ?? null,
    authorName: item.author?.name || null,
    authorUsername: item.author?.username || null,
    authorAvatar: item.author?.avatar || null,
    authorFollowers: item.author?.followers ?? null,
    authorVerified: item.author?.verified ?? null,
    publishedAt: item.publishedAt?.toISOString() || null,
    createdAt: new Date().toISOString(),
    keyword: null,
    analysis
  };
}

// 获取所有热点
router.get('/', async (req, res) => {
  try {
    const { 
      page = '1', 
      limit = '20', 
      source, 
      importance,
      keywordId,
      isReal,
      timeRange,
      timeFrom,
      timeTo,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};
    if (source) where.source = source;
    if (importance) where.importance = importance;
    if (keywordId) where.keywordId = keywordId;
    if (isReal !== undefined && isReal !== '') {
      where.isReal = isReal === 'true';
    }

    // 时间范围筛选
    if (timeRange) {
      const now = new Date();
      let dateFrom: Date | null = null;
      switch (timeRange) {
        case '1h':
          dateFrom = new Date(now.getTime() - 60 * 60 * 1000);
          break;
        case 'today':
          dateFrom = new Date(now);
          dateFrom.setHours(0, 0, 0, 0);
          break;
        case '7d':
          dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
      }
      if (dateFrom) {
        where.createdAt = { gte: dateFrom };
      }
    } else if (timeFrom || timeTo) {
      where.createdAt = {};
      if (timeFrom) where.createdAt.gte = new Date(timeFrom as string);
      if (timeTo) where.createdAt.lte = new Date(timeTo as string);
    }

    // 排序处理
    let orderBy: any;
    const sort = sortBy as string;
    const order = (sortOrder as string) === 'asc' ? 'asc' : 'desc';

    // importance 和 hot 需要在内存中排序（Prisma 不支持自定义排序）
    const needsMemorySort = sort === 'importance' || sort === 'hot';

    switch (sort) {
      case 'publishedAt':
        orderBy = [{ publishedAt: order }, { createdAt: 'desc' }];
        break;
      case 'relevance':
        orderBy = { relevance: order };
        break;
      case 'importance':
      case 'hot':
        orderBy = { createdAt: 'desc' };
        break;
      default:
        orderBy = { createdAt: order };
        break;
    }

    const [rawHotspots, total] = await Promise.all([
      prisma.hotspot.findMany({
        where,
        orderBy,
        ...(needsMemorySort ? {} : { skip, take: limitNum }),
        include: {
          keyword: {
            select: { id: true, text: true, category: true }
          }
        }
      }),
      prisma.hotspot.count({ where })
    ]);

    let hotspots;
    if (needsMemorySort) {
      const sorted = sortHotspots(rawHotspots, sort, order as 'asc' | 'desc');
      hotspots = sorted.slice(skip, skip + limitNum);
    } else {
      hotspots = rawHotspots;
    }

    res.json({
      data: hotspots,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching hotspots:', error);
    res.status(500).json({ error: 'Failed to fetch hotspots' });
  }
});

// 获取热点统计
router.get('/stats', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalHotspots,
      todayHotspots,
      urgentHotspots,
      sourceStats
    ] = await Promise.all([
      prisma.hotspot.count(),
      prisma.hotspot.count({
        where: { createdAt: { gte: today } }
      }),
      prisma.hotspot.count({
        where: { importance: 'urgent' }
      }),
      prisma.hotspot.groupBy({
        by: ['source'],
        _count: { source: true }
      })
    ]);

    res.json({
      total: totalHotspots,
      today: todayHotspots,
      urgent: urgentHotspots,
      bySource: sourceStats.reduce((acc: Record<string, number>, item: { source: string; _count: { source: number } }) => {
        acc[item.source] = item._count.source;
        return acc;
      }, {} as Record<string, number>)
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// 获取单个热点
router.get('/:id', async (req, res) => {
  try {
    const hotspot = await prisma.hotspot.findUnique({
      where: { id: req.params.id },
      include: {
        keyword: true
      }
    });

    if (!hotspot) {
      return res.status(404).json({ error: 'Hotspot not found' });
    }

    res.json(hotspot);
  } catch (error) {
    console.error('Error fetching hotspot:', error);
    res.status(500).json({ error: 'Failed to fetch hotspot' });
  }
});

// 手动搜索热点
router.post('/search', async (req, res) => {
  try {
    const { query, sources = ['twitter', 'bing', 'github'] } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    // 导入搜索服务
    const { searchTwitter } = await import('../services/twitter.js');
    const { searchBing } = await import('../services/search.js');
    const { collectGitHub, parseRepoReference } = await import('../services/github.js');
    const { analyzeContent } = await import('../services/ai.js');

    const repoSyntax = String(query).trim();
    if (repoSyntax.startsWith('repo:') && !parseRepoReference(repoSyntax)) {
      return res.status(400).json({ error: 'Invalid GitHub repository format. Use repo:owner/name.' });
    }

    const results: any[] = [];
    const errors: string[] = [];

    // Twitter 搜索
    if (sources.includes('twitter')) {
      try {
        const tweets = await searchTwitter(query);
        results.push(...tweets);
      } catch (error) {
        console.error('Twitter search failed:', error);
        errors.push('Twitter 搜索失败');
      }
    }

    // Bing 搜索
    if (sources.includes('bing')) {
      try {
        const webResults = await searchBing(query);
        results.push(...webResults);
      } catch (error) {
        console.error('Bing search failed:', error);
        errors.push('Bing 搜索失败');
      }
    }

    if (sources.includes('github')) {
      try {
        results.push(...await collectGitHub(query));
      } catch (error) {
        console.error('GitHub search failed:', error);
        errors.push(error instanceof Error ? `GitHub 搜索失败：${error.message}` : 'GitHub 搜索失败');
      }
    }

    // AI 分析前几个结果
    const analyzedResults = await Promise.all(
      results.slice(0, 10).map(async (item) => {
        try {
          const repo = parseRepoReference(query);
          const analysis = await analyzeContent(item.title + ' ' + item.content, repo?.fullName || query);
          return toSearchHotspot(item, analysis);
        } catch {
          return toSearchHotspot(item, null);
        }
      })
    );

    res.json({ results: analyzedResults, errors });
  } catch (error) {
    console.error('Error searching hotspots:', error);
    res.status(500).json({ error: 'Failed to search hotspots' });
  }
});

// 删除热点
router.delete('/:id', async (req, res) => {
  try {
    await prisma.hotspot.delete({
      where: { id: req.params.id }
    });

    res.status(204).send();
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Hotspot not found' });
    }
    console.error('Error deleting hotspot:', error);
    res.status(500).json({ error: 'Failed to delete hotspot' });
  }
});

export default router;
