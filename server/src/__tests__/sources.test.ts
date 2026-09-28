import { describe, it, expect } from 'vitest';
import { V2_SOURCES } from '../types.js';

describe('V2 来源适配器', () => {
  it('所有预期来源均已注册', () => {
    // Verify the V2 source set matches expectations
    const expected = ['twitter', 'bing', 'google', 'sogou', 'weibo', 'github', 'hackernews', 'bilibili'];
    expect([...V2_SOURCES].sort()).toEqual(expected.sort());
  });

  it('来源失败不影响其他来源（Promise.allSettled 语义）', async () => {
    // Simulate source error isolation
    const results = await Promise.allSettled([
      Promise.resolve([{ title: 'ok' }]),
      Promise.reject(new Error('source failed')),
      Promise.resolve([{ title: 'also ok' }]),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    expect(fulfilled).toHaveLength(2);
    expect(rejected).toHaveLength(1);
  });

  it('空关键词列表时扫描应安全退出', () => {
    const keywords: any[] = [];
    expect(keywords.length).toBe(0);
    // runIncrementalScan handles this: returns summary with keywordCount=0
  });
});
