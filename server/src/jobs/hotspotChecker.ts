import { Server } from 'socket.io';
import { prisma } from '../db.js';
import { searchTwitter } from '../services/twitter.js';
import { searchBing, searchGoogle, searchHackerNews, deduplicateResults } from '../services/search.js';
import { searchSogou, searchBilibili, searchWeibo, detectAndFetchAccount } from '../services/chinaSearch.js';
import { analyzeContent, expandKeyword, preMatchKeyword } from '../services/ai.js';
import { sendHotspotEmail } from '../services/email.js';
import { collectGitHub, parseRepoReference } from '../services/github.js';
import type { SearchResult, SourceAdapter, ScanRunSummary, SourceScanStats } from '../types.js';

const MAX_AGE_HOURS = 7 * 24;

/** 增量水位重叠窗口（毫秒），避免时钟偏差和延迟造成漏采 */
const WATERMARK_OVERLAP_MS = 5 * 60 * 1000; // 5 分钟

/** V2 来源适配器注册表 */
const SOURCE_ADAPTERS: Record<string, SourceAdapter> = {
  twitter: searchTwitter,
  bing: searchBing,
  google: searchGoogle,
  hackernews: searchHackerNews,
  sogou: searchSogou,
  bilibili: searchBilibili,
  weibo: searchWeibo,
  github: collectGitHub,
};

function filterByFreshness(results: SearchResult[]): SearchResult[] {
  return results.filter(item => {
    if (!item.publishedAt) return true;
    const maxAgeHours = item.source === 'github' && item.eventType === 'repository' ? 30 * 24 : MAX_AGE_HOURS;
    const cutoff = new Date(Date.now() - maxAgeHours * 3600 * 1000);
    return item.publishedAt >= cutoff;
  });
}

function prioritizeResults(results: SearchResult[]): SearchResult[] {
  const priorityMap: Record<string, number> = {
    twitter: 1, weibo: 2, github: 3, bilibili: 4, hackernews: 5,
    sogou: 6, bing: 7, google: 8, duckduckgo: 9
  };
  return [...results].sort((a, b) =>
    (priorityMap[a.source] || 99) - (priorityMap[b.source] || 99)
  );
}

/**
 * V2 增量扫描：由调度器调用，扫描所有启用关键词的所有来源。
 * 返回本次扫描摘要（不含 durationMs，由调度器补充）。
 */
export async function runIncrementalScan(
  io: Server,
  scanRunId: string
): Promise<Omit<ScanRunSummary, 'durationMs'>> {
  console.log('🔍 开始增量扫描...');

  const keywords = await prisma.keyword.findMany({ where: { isActive: true } });

  const summary: Omit<ScanRunSummary, 'durationMs'> = {
    keywordCount: keywords.length,
    newCount: 0,
    updatedCount: 0,
    filteredCount: 0,
    sourceStats: {}
  };

  if (keywords.length === 0) {
    console.log('没有启用的监控词，空运行结束');
    return summary;
  }

  console.log(`扫描 ${keywords.length} 个关键词...`);

  for (const keyword of keywords) {
    console.log(`\n📎 扫描关键词: "${keyword.text}"`);

    try {
      // 账号检测
      const accountResult = await detectAndFetchAccount(keyword.text);
      const accountResults = accountResult.results;

      // Query Expansion
      const expandedKeywords = await expandKeyword(keyword.text);

      // 并行执行所有来源，每个独立超时和错误隔离
      const sourceNames = Object.keys(SOURCE_ADAPTERS);
      const sourcePromises = sourceNames.map(name => {
        const adapter = SOURCE_ADAPTERS[name];
        const start = Date.now();
        return adapter(keyword.text)
          .then(results => ({ name, results, error: undefined, durationMs: Date.now() - start }))
          .catch(err => ({ name, results: [] as SearchResult[], error: String(err), durationMs: Date.now() - start }));
      });

      const sourceResults = await Promise.all(sourcePromises);

      // 加载各来源已有水位，用于增量过滤
      const scanStates = await prisma.keywordScanState.findMany({
        where: { keywordId: keyword.id }
      });
      const watermarks = new Map(scanStates.map(s => [s.source, s.watermarkAt]));

      // 汇总来源结果（按水位做增量过滤）
      let allResults: SearchResult[] = [...accountResults];
      for (const sr of sourceResults) {
        if (!summary.sourceStats[sr.name]) {
          summary.sourceStats[sr.name] = { resultCount: 0, newCount: 0, updatedCount: 0, filteredCount: 0, durationMs: 0 };
        }
        const stat = summary.sourceStats[sr.name];
        stat.resultCount += sr.results.length;
        stat.durationMs += sr.durationMs;
        if (sr.error) {
          stat.error = sr.error;
          console.log(`  ${sr.name}: 失败 - ${sr.error}`);
        } else {
          // 增量水位过滤：丢弃已处理过的旧内容（保留重叠窗口）
          const wm = watermarks.get(sr.name);
          let filtered = sr.results;
          if (wm) {
            const cutoff = new Date(wm.getTime() - WATERMARK_OVERLAP_MS);
            filtered = sr.results.filter(r => !r.publishedAt || r.publishedAt >= cutoff);
          }
          allResults.push(...filtered);
          console.log(`  ${sr.name}: ${sr.results.length} 条${wm ? ` (水位过滤后 ${filtered.length})` : ''}`);
        }
      }

      // 去重 → 新鲜度过滤 → 排序
      const uniqueResults = deduplicateResults(allResults);
      const freshResults = filterByFreshness(uniqueResults);
      const sortedResults = prioritizeResults(freshResults);
      console.log(`  总计: ${allResults.length} 原始 → ${uniqueResults.length} 去重 → ${freshResults.length} 新鲜`);

      // 处理结果
      const kwResult = await processKeywordResults(
        io, keyword, sortedResults, expandedKeywords
      );

      summary.newCount += kwResult.newCount;
      summary.updatedCount += kwResult.updatedCount;
      summary.filteredCount += kwResult.filteredCount;

      // 更新关键词来源扫描水位
      for (const sr of sourceResults) {
        await updateScanState(keyword.id, sr.name, sr.results, sr.error);
      }

      // 避免过快请求
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`关键词 "${keyword.text}" 扫描异常:`, error);
    }
  }

  console.log(`\n✨ 增量扫描完成。新增 ${summary.newCount}，更新 ${summary.updatedCount}，过滤 ${summary.filteredCount}`);
  return summary;
}

/** 处理单个关键词的所有结果：去重入库、AI 分析、通知 */
async function processKeywordResults(
  io: Server,
  keyword: { id: string; text: string },
  results: SearchResult[],
  expandedKeywords: string[]
): Promise<{ newCount: number; updatedCount: number; filteredCount: number }> {
  let newCount = 0;
  let updatedCount = 0;
  let filteredCount = 0;

  let twitterProcessed = 0;
  let otherProcessed = 0;
  let githubProcessed = 0;
  const TWITTER_QUOTA = 15;
  const OTHER_QUOTA = 10;
  const GITHUB_QUOTA = 10;

  for (const item of results) {
    if (item.source === 'twitter' && twitterProcessed >= TWITTER_QUOTA) continue;
    if (item.source === 'github' && githubProcessed >= GITHUB_QUOTA) continue;
    if (item.source !== 'twitter' && item.source !== 'github' && otherProcessed >= OTHER_QUOTA) continue;
    if (item.source !== 'github' && twitterProcessed + otherProcessed >= TWITTER_QUOTA + OTHER_QUOTA) continue;

    try {
      const existing = await prisma.hotspot.findFirst({
        where: { url: item.url, source: item.source }
      });

      if (existing) {
        // 已存在：只更新指标，不重新 AI 分析或通知
        const updateData: any = {};
        if (item.starCount != null) updateData.starCount = item.starCount;
        if (item.forkCount != null) updateData.forkCount = item.forkCount;
        if (item.watcherCount != null) updateData.watcherCount = item.watcherCount;
        if (item.language) updateData.language = item.language;
        if (item.pushedAt) updateData.pushedAt = item.pushedAt;
        if (item.viewCount != null) updateData.viewCount = item.viewCount;
        if (item.likeCount != null) updateData.likeCount = item.likeCount;
        if (item.retweetCount != null) updateData.retweetCount = item.retweetCount;
        if (item.commentCount != null) updateData.commentCount = item.commentCount;
        if (item.danmakuCount != null) updateData.danmakuCount = item.danmakuCount;

        if (Object.keys(updateData).length > 0) {
          await prisma.hotspot.update({ where: { id: existing.id }, data: updateData });
          updatedCount++;
        }
        continue;
      }

      // AI 分析
      const fullText = item.title + '\n' + item.content;
      const preMatch = preMatchKeyword(fullText, expandedKeywords);
      const githubRepo = parseRepoReference(keyword.text);
      const analysisTopic = githubRepo?.fullName || keyword.text;
      const analysis = await analyzeContent(fullText, analysisTopic, preMatch);

      if (!analysis.isReal) { filteredCount++; continue; }
      if (analysis.relevance < 50) { filteredCount++; continue; }
      if (!analysis.keywordMentioned && analysis.relevance < 65) { filteredCount++; continue; }

      // 保存新热点
      const hotspot = await prisma.hotspot.create({
        data: {
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
          pushedAt: item.pushedAt || null,
          isReal: analysis.isReal,
          relevance: analysis.relevance,
          relevanceReason: analysis.relevanceReason || null,
          keywordMentioned: analysis.keywordMentioned ?? null,
          importance: analysis.importance,
          summary: analysis.summary,
          viewCount: item.viewCount || null,
          likeCount: item.likeCount || null,
          retweetCount: item.retweetCount || null,
          replyCount: item.replyCount || null,
          commentCount: item.commentCount || null,
          quoteCount: item.quoteCount || null,
          danmakuCount: item.danmakuCount || null,
          authorName: item.author?.name || null,
          authorUsername: item.author?.username || null,
          authorAvatar: item.author?.avatar || null,
          authorFollowers: item.author?.followers || null,
          authorVerified: item.author?.verified ?? null,
          publishedAt: item.publishedAt || null,
          keywordId: keyword.id
        },
        include: { keyword: true }
      });

      newCount++;
      if (item.source === 'twitter') twitterProcessed++;
      else if (item.source === 'github') githubProcessed++;
      else otherProcessed++;

      console.log(`  ✅ 新热点 [${item.source}]: ${hotspot.title.slice(0, 40)}... (${analysis.importance})`);

      // 通知
      await prisma.notification.create({
        data: {
          type: 'hotspot',
          title: `发现新热点: ${hotspot.title.slice(0, 50)}`,
          content: analysis.summary || hotspot.content.slice(0, 100),
          hotspotId: hotspot.id
        }
      });

      io.to(`keyword:${keyword.text}`).emit('hotspot:new', hotspot);
      io.emit('notification', {
        type: 'hotspot', title: '发现新热点', content: hotspot.title,
        hotspotId: hotspot.id, importance: hotspot.importance
      });

      if (['high', 'urgent'].includes(analysis.importance)) {
        await sendHotspotEmail(hotspot);
      }
    } catch (error) {
      console.error('  处理结果异常:', error);
    }
  }

  return { newCount, updatedCount, filteredCount };
}

/** 更新关键词 × 来源的扫描水位 */
async function updateScanState(
  keywordId: string,
  source: string,
  results: SearchResult[],
  error?: string
): Promise<void> {
  const now = new Date();
  const latestPublishedAt = results
    .filter(r => r.publishedAt)
    .reduce((max, r) => (r.publishedAt! > max ? r.publishedAt! : max), new Date(0));

  await prisma.keywordScanState.upsert({
    where: { keywordId_source: { keywordId, source } },
    create: {
      keywordId,
      source,
      lastStartedAt: now,
      lastSuccessAt: error ? undefined : now,
      watermarkAt: latestPublishedAt.getTime() > 0 ? latestPublishedAt : undefined,
      lastResultCount: results.length,
      lastNewCount: 0,
      lastUpdatedCount: 0,
      lastStatus: error ? 'failed' : results.length > 0 ? 'success' : 'empty',
      lastError: error || null,
    },
    update: {
      lastStartedAt: now,
      ...(error
        ? { lastStatus: 'failed', lastError: error }
        : {
            lastSuccessAt: now,
            lastStatus: results.length > 0 ? 'success' : 'empty',
            lastError: null,
            ...(latestPublishedAt.getTime() > 0 ? { watermarkAt: latestPublishedAt } : {})
          }),
      lastResultCount: results.length,
    }
  });
}

/**
 * V1 兼容：保留旧的 runHotspotCheck 签名供可能的外部调用。
 * 内部委托给 runIncrementalScan。
 */
export async function runHotspotCheck(io: Server): Promise<void> {
  await runIncrementalScan(io, 'legacy-' + Date.now());
}
