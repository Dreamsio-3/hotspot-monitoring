import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import type { SearchResult } from '../types.js';

const GITHUB_API = 'https://api.github.com';
const MAX_RETRIES = 1;

type CacheEntry = { etag?: string; data: unknown };
const etagCache = new Map<string, CacheEntry>();

export interface GitHubRepository {
  id: number;
  full_name: string;
  name: string;
  html_url: string;
  description: string | null;
  stargazers_count?: number;
  forks_count?: number;
  subscribers_count?: number;
  watchers_count?: number;
  language?: string | null;
  pushed_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  created_at: string;
  published_at: string | null;
  author?: { login?: string; avatar_url?: string } | null;
}

export interface GitHubSearchResponse {
  total_count: number;
  items: GitHubRepository[];
}

export class GitHubApiError extends Error {
  status?: number;
  retryAfter?: number;
  constructor(message: string, status?: number, retryAfter?: number) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** Parse the explicit repo:owner/name monitor syntax. */
export function parseRepoReference(value: string): { owner: string; repo: string; fullName: string } | null {
  const match = value.trim().match(/^repo:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], fullName: `${match[1]}/${match[2]}` };
}

function headers(etag?: string): Record<string, string> {
  const result: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'hotpulse/2.0'
  };
  if (process.env.GITHUB_TOKEN) result.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  if (etag) result['If-None-Match'] = etag;
  return result;
}

function requestTimeoutMs(): number {
  const configured = Number(process.env.GITHUB_TIMEOUT_MS || 10000);
  return Number.isFinite(configured) && configured > 0 ? configured : 10000;
}

function retryDelay(error: AxiosError): number | undefined {
  const response = error.response;
  if (!response || (response.status !== 403 && response.status !== 429)) return undefined;
  const retryAfterHeader = response.headers['retry-after'];
  const resetHeader = response.headers['x-ratelimit-reset'];
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
  const resetAt = resetHeader ? Number(resetHeader) * 1000 : undefined;
  const delay = retryAfter ?? (resetAt ? Math.max(0, resetAt - Date.now()) : undefined);
  return delay === undefined ? 1000 : Math.min(Math.max(delay, 0), 5000);
}

async function request<T>(path: string): Promise<T> {
  const url = `${GITHUB_API}${path}`;
  const cached = etagCache.get(url);
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const config: AxiosRequestConfig = { timeout: requestTimeoutMs(), headers: headers(cached?.etag) };
    try {
      const response = await axios.get<T>(url, config);
      const etag = response.headers.etag;
      etagCache.set(url, { etag, data: response.data });
      return response.data;
    } catch (error) {
      lastError = error;
      const axiosError = error as AxiosError;
      if (axiosError.response?.status === 304 && cached) return cached.data as T;
      const delay = retryDelay(axiosError);
      if (delay === undefined || attempt >= MAX_RETRIES) {
        const status = axiosError.response?.status;
        const message = status === 401
          ? 'GitHub token is invalid or unauthorized'
          : status === 404
            ? 'GitHub repository was not found'
            : status === 403 || status === 429
              ? 'GitHub API rate limit exceeded'
              : axiosError.code === 'ECONNABORTED'
                ? 'GitHub API request timed out'
                : 'GitHub API request failed';
        throw new GitHubApiError(message, status, delay);
      }
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

export function repositoryToResult(repository: GitHubRepository): SearchResult {
  const pushedAt = repository.pushed_at || repository.updated_at || repository.created_at;
  return {
    title: repository.full_name,
    content: repository.description || 'GitHub repository without a description.',
    url: repository.html_url,
    source: 'github',
    sourceId: String(repository.id),
    eventType: 'repository',
    repoFullName: repository.full_name,
    starCount: repository.stargazers_count ?? 0,
    forkCount: repository.forks_count ?? 0,
    // GitHub's watchers_count is not subscribers. Use subscribers_count when available.
    watcherCount: repository.subscribers_count,
    language: repository.language || undefined,
    publishedAt: pushedAt ? new Date(pushedAt) : undefined,
    pushedAt: pushedAt ? new Date(pushedAt) : undefined,
    author: { name: repository.full_name.split('/')[0] }
  };
}

export function releaseToResult(release: GitHubRelease, repository: GitHubRepository): SearchResult {
  const body = release.body?.trim() || '该 Release 没有提供正文。';
  const publishedAt = release.published_at || release.created_at;
  return {
    title: `${repository.full_name} ${release.tag_name}${release.name ? ` · ${release.name}` : ''}`,
    content: body,
    url: release.html_url,
    source: 'github',
    sourceId: String(release.id),
    eventType: 'release',
    repoFullName: repository.full_name,
    starCount: repository.stargazers_count ?? 0,
    forkCount: repository.forks_count ?? 0,
    watcherCount: repository.subscribers_count ?? 0,
    language: repository.language || undefined,
    releaseTagName: release.tag_name,
    releaseIsPrerelease: release.prerelease,
    publishedAt: new Date(publishedAt),
    author: release.author?.login ? { name: release.author.login, avatar: release.author.avatar_url } : undefined
  };
}

export async function searchGitHubRepositories(query: string, perPage = 10): Promise<SearchResult[]> {
  const activeSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const params = new URLSearchParams({ q: `${query} in:name,description pushed:>=${activeSince}`, sort: 'updated', order: 'desc', per_page: String(perPage) });
  const data = await request<GitHubSearchResponse>(`/search/repositories?${params.toString()}`);
  return (data.items || []).map(repositoryToResult);
}

export async function getGitHubRepository(fullName: string): Promise<SearchResult> {
  const parsed = parseRepoReference(fullName.startsWith('repo:') ? fullName : `repo:${fullName}`);
  if (!parsed) throw new GitHubApiError('Invalid repository format. Use repo:owner/name.');
  const data = await request<GitHubRepository>(`/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`);
  return repositoryToResult(data);
}

export async function getGitHubReleases(fullName: string, perPage = 10): Promise<SearchResult[]> {
  const repository = await getGitHubRepository(fullName);
  const parsed = parseRepoReference(fullName.startsWith('repo:') ? fullName : `repo:${fullName}`);
  if (!parsed) return [];
  const releases = await request<GitHubRelease[]>(`/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/releases?per_page=${perPage}`);
  return (releases || []).filter(release => !release.draft).map(release => releaseToResult(release, {
    id: Number(repository.sourceId), full_name: repository.repoFullName!, name: repository.repoFullName!.split('/')[1], html_url: repository.url,
    description: repository.content, stargazers_count: repository.starCount, forks_count: repository.forkCount,
    subscribers_count: repository.watcherCount, language: repository.language,
  }));
}

export async function collectGitHub(query: string): Promise<SearchResult[]> {
  const repo = parseRepoReference(query);
  if (query.trim().startsWith('repo:') && !repo) {
    throw new GitHubApiError('Invalid GitHub repository format. Use repo:owner/name.');
  }
  return repo ? getGitHubReleases(repo.fullName) : searchGitHubRepositories(query);
}

/** Test helper: clear conditional request cache between isolated tests. */
export function clearGitHubCache(): void { etagCache.clear(); }
