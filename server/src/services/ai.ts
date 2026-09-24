import { OpenRouter } from '@openrouter/sdk';
import type { AIAnalysis } from '../types.js';

const openRouter = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY ?? ''
});

// ========== Query Expansion（查询扩展） ==========

/**
 * 使用 AI 将关键词扩展为多个变体，用于文本预过滤。
 * 返回扩展后的关键词列表（含原始关键词）。
 * 结果会被缓存，同一关键词不会重复调用 AI。
 */
const expansionCache = new Map<string, string[]>();

export async function expandKeyword(keyword: string): Promise<string[]> {
  // 缓存命中
  if (expansionCache.has(keyword)) {
    return expansionCache.get(keyword)!;
  }

  // 不管 AI 是否可用，先提取基础核心词
  const coreTerms = extractCoreTerms(keyword);

  if (!process.env.OPENROUTER_API_KEY) {
    const result = [keyword, ...coreTerms];
    expansionCache.set(keyword, result);
    return result;
  }

  try {
    const result = await openRouter.chat.send({
      model: 'deepseek/deepseek-v3.2',
      messages: [
        {
          role: 'system',
          content: `你是一个搜索查询扩展专家。给定一个监控关键词，生成该关键词的变体和相关检索词，用于文本匹配。

规则：
1. 包含原始关键词的各种写法（大小写、空格、连字符变体）
2. 包含关键词的核心组成词（拆分后的各个有意义的词）
3. 包含常见别称、缩写、中英文对照
4. 不要加入泛化词（比如关键词是"Claude Sonnet 4.6"，不要加"AI模型"这种泛化词）
5. 总数控制在 5-15 个

输出 JSON 数组，只输出 JSON，不要有其他内容。
示例输入："Claude Sonnet 4.6"
示例输出：["Claude Sonnet 4.6", "Claude Sonnet", "Sonnet 4.6", "claude-sonnet-4.6", "Claude 4.6", "Anthropic Sonnet"]`
        },
        {
          role: 'user',
          content: keyword
        }
      ],
      temperature: 0.2,
      maxTokens: 300
    });

    const rawContent = result.choices[0]?.message?.content || '';
    const responseContent = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
    const jsonMatch = responseContent.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed: string[] = JSON.parse(jsonMatch[0]);
      // 确保原始关键词和核心词都在列表中
      const expanded = [...new Set([keyword, ...coreTerms, ...parsed.map(s => s.trim()).filter(Boolean)])];
      expansionCache.set(keyword, expanded);
      console.log(`  🔍 Query expansion for "${keyword}": ${expanded.length} variants`);
      return expanded;
    }
  } catch (error) {
    console.error('Query expansion failed:', error);
  }

  // Fallback：使用基础核心词
  const fallback = [keyword, ...coreTerms];
  expansionCache.set(keyword, fallback);
  return fallback;
}

/**
 * 从关键词中提取核心词（纯文本方式，不依赖 AI）
 */
function extractCoreTerms(keyword: string): string[] {
  const terms: string[] = [];
  // 按空格、连字符、下划线分割
  const parts = keyword.split(/[\s\-_\/\\·]+/).filter(p => p.length >= 2);
  if (parts.length > 1) {
    terms.push(...parts);
    // 两两组合
    for (let i = 0; i < parts.length - 1; i++) {
      terms.push(parts[i] + ' ' + parts[i + 1]);
    }
  }
  // 去重，排除原始关键词本身
  return [...new Set(terms)].filter(t => t.toLowerCase() !== keyword.toLowerCase());
}

// ========== 关键词预匹配 ==========

/**
 * 检查文本中是否包含任一扩展关键词（不区分大小写）。
 * 返回是否匹配以及匹配到的词。
 */
export function preMatchKeyword(text: string, expandedKeywords: string[]): { matched: boolean; matchedTerms: string[] } {
  const lowerText = text.toLowerCase();
  const matchedTerms: string[] = [];
  for (const kw of expandedKeywords) {
    if (lowerText.includes(kw.toLowerCase())) {
      matchedTerms.push(kw);
    }
  }
  return { matched: matchedTerms.length > 0, matchedTerms };
}

// ========== AI 内容分析（关键词感知） ==========

function buildAnalysisPrompt(keyword: string, preMatchResult: { matched: boolean; matchedTerms: string[] }): string {
  const matchHint = preMatchResult.matched 
    ? `\n注意：文本预匹配发现内容中包含以下关键词变体：${preMatchResult.matchedTerms.join('、')}` 
    : `\n注意：文本预匹配发现内容中未直接提及关键词"${keyword}"的任何变体，请特别严格审核相关性。`;

  return `你是一个热点内容精准匹配专家。你的任务是判断一段内容是否与指定的监控关键词【${keyword}】直接相关。

${matchHint}

分析要点：
1. 判断是否为真实有价值的信息（排除标题党、假新闻、营销软文）
2. 判断内容是否【直接】涉及关键词"${keyword}"。注意：
   - 仅仅属于同一领域但未提及关键词的内容，相关性应低于 40 分
   - 内容必须直接讨论、提及或与"${keyword}"有实质关联才能获得 60 分以上
   - 只是间接沾边（如同类产品、同领域但不同主题）应给 30-50 分
3. 判断内容中是否直接提及了"${keyword}"或其等价表述（keywordMentioned）
4. 评估热点的重要程度（对关注"${keyword}"的人来说有多重要）
5. 用一句话说明此内容与"${keyword}"的关系（不是介绍内容本身，而是说"此内容与关键词的关联是什么"）
6. 用一句话解释你的相关性打分理由

请以 JSON 格式输出：
{
  "isReal": true/false,
  "relevance": 0-100,
  "relevanceReason": "相关性打分理由...",
  "keywordMentioned": true/false,
  "importance": "low/medium/high/urgent",
  "summary": "此内容与【${keyword}】的关联：..."
}

只输出 JSON，不要有其他内容。`;
}

export async function analyzeContent(content: string, keyword: string, preMatchResult?: { matched: boolean; matchedTerms: string[] }): Promise<AIAnalysis> {
  // 默认预匹配结果
  const matchResult = preMatchResult ?? { matched: false, matchedTerms: [] };

  if (!process.env.OPENROUTER_API_KEY) {
    console.warn('OpenRouter API key not configured, using fallback analysis');
    return {
      isReal: true,
      relevance: matchResult.matched ? 50 : 20,
      relevanceReason: '未配置 AI 服务，使用默认分数',
      keywordMentioned: matchResult.matched,
      importance: 'low',
      summary: content.slice(0, 50) + '...'
    };
  }

  try {
    const prompt = buildAnalysisPrompt(keyword, matchResult);

    const result = await openRouter.chat.send({
      model: 'deepseek/deepseek-v3.2',
      messages: [
        {
          role: 'system',
          content: prompt
        },
        {
          role: 'user',
          content: content.slice(0, 2000) // 限制内容长度
        }
      ],
      temperature: 0.2, // 降低温度，提高判断一致性
      maxTokens: 500
    });

    const rawContent = result.choices[0]?.message?.content || '';
    const responseContent = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
    
    // 尝试解析 JSON
    const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        isReal: Boolean(parsed.isReal),
        relevance: Math.min(100, Math.max(0, Number(parsed.relevance) || 0)),
        relevanceReason: String(parsed.relevanceReason || '').slice(0, 200),
        keywordMentioned: Boolean(parsed.keywordMentioned),
        importance: ['low', 'medium', 'high', 'urgent'].includes(parsed.importance) 
          ? parsed.importance 
          : 'low',
        summary: String(parsed.summary || '').slice(0, 150)
      };
    }

    throw new Error('Failed to parse AI response');
  } catch (error) {
    console.error('AI analysis failed:', error);
    // Fallback
    return {
      isReal: true,
      relevance: matchResult.matched ? 30 : 10,
      relevanceReason: 'AI 分析失败，使用默认分数',
      keywordMentioned: matchResult.matched,
      importance: 'low',
      summary: content.slice(0, 50) + '...'
    };
  }
}

export async function batchAnalyze(contents: string[], keyword: string, expandedKeywords?: string[]): Promise<AIAnalysis[]> {
  // 并行分析，但限制并发数
  const batchSize = 3;
  const results: AIAnalysis[] = [];

  for (let i = 0; i < contents.length; i += batchSize) {
    const batch = contents.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(content => {
        const preMatch = expandedKeywords 
          ? preMatchKeyword(content, expandedKeywords) 
          : undefined;
        return analyzeContent(content, keyword, preMatch);
      })
    );
    results.push(...batchResults);
  }

  return results;
}
