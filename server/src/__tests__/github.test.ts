import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearGitHubCache, parseRepoReference, repositoryToResult, releaseToResult, searchGitHubRepositories } from '../services/github.js';
import { calcHotScore } from '../utils/sortHotspots.js';

afterEach(() => {
  vi.restoreAllMocks();
  clearGitHubCache();
});

describe('GitHub source mapping', () => {
  it('parses only the explicit repo:owner/name syntax', () => {
    expect(parseRepoReference('repo:ollama/ollama')).toEqual({ owner: 'ollama', repo: 'ollama', fullName: 'ollama/ollama' });
    expect(parseRepoReference('AI agent')).toBeNull();
    expect(parseRepoReference('repo:owner')).toBeNull();
    expect(parseRepoReference('repo:owner/name extra')).toBeNull();
  });

  it('maps repository metrics without confusing watchers and subscribers', () => {
    const result = repositoryToResult({
      id: 1, full_name: 'acme/agent', name: 'agent', html_url: 'https://github.com/acme/agent',
      description: null, stargazers_count: 10, forks_count: 2, watchers_count: 99,
      subscribers_count: 7, language: 'TypeScript', pushed_at: '2026-09-24T00:00:00Z'
    });
    expect(result.source).toBe('github');
    expect(result.eventType).toBe('repository');
    expect(result.watcherCount).toBe(7);
    expect(result.content).toContain('without a description');
  });

  it('maps release body, tag and prerelease state', () => {
    const result = releaseToResult({
      id: 2, tag_name: 'v1.2.0', name: null, body: null,
      html_url: 'https://github.com/acme/agent/releases/tag/v1.2.0', draft: false,
      prerelease: true, created_at: '2026-09-23T00:00:00Z', published_at: null
    }, {
      id: 1, full_name: 'acme/agent', name: 'agent', html_url: 'https://github.com/acme/agent',
      description: 'Agent toolkit', stargazers_count: 10, forks_count: 2, subscribers_count: 7, language: 'TypeScript'
    });
    expect(result.eventType).toBe('release');
    expect(result.releaseTagName).toBe('v1.2.0');
    expect(result.releaseIsPrerelease).toBe(true);
    expect(result.content).toContain('没有提供正文');
  });

  it('reuses an ETag cached response after a 304', async () => {
    const get = vi.spyOn(axios, 'get')
      .mockResolvedValueOnce({ data: { items: [] }, headers: { etag: '"abc"' } } as any)
      .mockRejectedValueOnce({ response: { status: 304 } });
    await searchGitHubRepositories('agent', 1);
    const second = await searchGitHubRepositories('agent', 1);
    expect(second).toEqual([]);
    expect(get.mock.calls[1][1]).toMatchObject({ headers: expect.objectContaining({ 'If-None-Match': '"abc"' }) });
  });

  it('retries a rate limited request once using the response wait hint', async () => {
    const get = vi.spyOn(axios, 'get')
      .mockRejectedValueOnce({ response: { status: 429, headers: { 'retry-after': '0' } } })
      .mockResolvedValueOnce({ data: { items: [] }, headers: {} } as any);
    await expect(searchGitHubRepositories('agent', 1)).resolves.toEqual([]);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('uses GitHub metrics in the shared heat score without using social like fields', () => {
    const score = calcHotScore({ likeCount: 0, retweetCount: 0, viewCount: 0, importance: 'low', relevance: 0, publishedAt: null, createdAt: new Date(), starCount: 1000, forkCount: 100, watcherCount: 10 });
    expect(score).toBeGreaterThan(0);
    expect(calcHotScore({ likeCount: 0, retweetCount: 0, viewCount: 0, importance: 'low', relevance: 0, publishedAt: null, createdAt: new Date() })).toBe(0);
  });
});
