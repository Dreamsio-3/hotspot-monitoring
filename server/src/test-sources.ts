/**
 * 逐一测试每个搜索源的可用性
 * 运行方式: npx tsx src/test-sources.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { searchTwitter } from './services/twitter.js';
import { searchBing, searchHackerNews } from './services/search.js';
import { searchSogou, searchBilibili, searchWeibo } from './services/chinaSearch.js';

const TEST_QUERY = 'Codex';

async function testSource(name: string, fn: () => Promise<any[]>) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Testing: ${name}`);
  console.log(`${'='.repeat(50)}`);
  try {
    const start = Date.now();
    const results = await fn();
    const elapsed = Date.now() - start;
    console.log(`✅ ${name}: ${results.length} results (${elapsed}ms)`);
    if (results.length > 0) {
      // 打印前 3 条
      results.slice(0, 3).forEach((r, i) => {
        console.log(`  [${i + 1}] ${r.title?.slice(0, 60)}`);
        console.log(`      URL: ${r.url?.slice(0, 80)}`);
        console.log(`      Source: ${r.source}, Published: ${r.publishedAt || 'N/A'}`);
      });
    }
    return { name, success: true, count: results.length, elapsed };
  } catch (error) {
    console.log(`❌ ${name}: ERROR - ${error instanceof Error ? error.message : error}`);
    return { name, success: false, count: 0, elapsed: 0 };
  }
}

async function main() {
  console.log(`\n🔍 Testing all search sources with query: "${TEST_QUERY}"\n`);

  const results = [];

  results.push(await testSource('Twitter', () => searchTwitter(TEST_QUERY)));
  results.push(await testSource('Bing', () => searchBing(TEST_QUERY)));
  results.push(await testSource('HackerNews', () => searchHackerNews(TEST_QUERY)));
  results.push(await testSource('Sogou', () => searchSogou(TEST_QUERY)));
  results.push(await testSource('Bilibili', () => searchBilibili(TEST_QUERY)));
  results.push(await testSource('Weibo', () => searchWeibo(TEST_QUERY)));

  console.log(`\n${'='.repeat(50)}`);
  console.log('SUMMARY');
  console.log(`${'='.repeat(50)}`);
  for (const r of results) {
    const status = r.success ? '✅' : '❌';
    console.log(`${status} ${r.name.padEnd(15)} ${String(r.count).padStart(3)} results  (${r.elapsed}ms)`);
  }
}

main().catch(console.error);
