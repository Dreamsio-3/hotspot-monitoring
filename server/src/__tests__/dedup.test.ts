import { describe, it, expect } from 'vitest';
import { deduplicateResults } from '../services/search.js';
import type { SearchResult } from '../types.js';

function makeResult(overrides: Partial<SearchResult>): SearchResult {
  return {
    title: 'Test',
    content: 'Test content',
    url: 'https://example.com/test',
    source: 'bing',
    ...overrides
  };
}

describe('deduplicateResults', () => {
  it('按 URL 去重（忽略 www 和尾部斜杠）', () => {
    const results = [
      makeResult({ url: 'https://www.example.com/page/' }),
      makeResult({ url: 'https://example.com/page' }),
    ];
    expect(deduplicateResults(results)).toHaveLength(1);
  });

  it('按 URL 去重（忽略锚点）', () => {
    const results = [
      makeResult({ url: 'https://example.com/page#section1' }),
      makeResult({ url: 'https://example.com/page#section2' }),
    ];
    expect(deduplicateResults(results)).toHaveLength(1);
  });

  it('sourceId 优先去重', () => {
    const results = [
      makeResult({ source: 'twitter', sourceId: 'tw-123', url: 'https://twitter.com/a' }),
      makeResult({ source: 'twitter', sourceId: 'tw-123', url: 'https://twitter.com/b' }),
    ];
    expect(deduplicateResults(results)).toHaveLength(1);
  });

  it('不同来源相同 URL 保留一个', () => {
    const results = [
      makeResult({ source: 'bing', url: 'https://example.com/page' }),
      makeResult({ source: 'google', url: 'https://example.com/page' }),
    ];
    expect(deduplicateResults(results)).toHaveLength(1);
  });

  it('不同 URL 不去重', () => {
    const results = [
      makeResult({ url: 'https://example.com/a' }),
      makeResult({ url: 'https://example.com/b' }),
    ];
    expect(deduplicateResults(results)).toHaveLength(2);
  });

  it('微博话题 sourceId 去重', () => {
    const results = [
      makeResult({ source: 'weibo', sourceId: 'weibo-topic:AI', url: 'https://s.weibo.com/weibo?q=%23AI%23' }),
      makeResult({ source: 'weibo', sourceId: 'weibo-topic:AI', url: 'https://s.weibo.com/weibo?q=%23AI%23' }),
    ];
    expect(deduplicateResults(results)).toHaveLength(1);
  });

  it('空数组返回空', () => {
    expect(deduplicateResults([])).toEqual([]);
  });
});
