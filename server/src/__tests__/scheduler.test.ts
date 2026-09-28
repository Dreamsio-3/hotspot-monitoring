import { describe, it, expect } from 'vitest';
import { ALLOWED_INTERVALS, V2_SOURCES } from '../types.js';

describe('V2 调度器配置', () => {
  it('ALLOWED_INTERVALS 包含 5/10/15/30/60', () => {
    expect(ALLOWED_INTERVALS).toEqual([5, 10, 15, 30, 60]);
  });

  it('V2_SOURCES 包含所有预期来源', () => {
    expect(V2_SOURCES).toContain('twitter');
    expect(V2_SOURCES).toContain('bing');
    expect(V2_SOURCES).toContain('google');
    expect(V2_SOURCES).toContain('sogou');
    expect(V2_SOURCES).toContain('weibo');
    expect(V2_SOURCES).toContain('github');
    expect(V2_SOURCES).toContain('hackernews');
    expect(V2_SOURCES).toContain('bilibili');
    expect(V2_SOURCES.length).toBe(8);
  });
});
