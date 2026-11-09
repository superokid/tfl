import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import worker from '../../src/worker/index';
import { isBot } from '../../src/worker/bots';

const env = { TFL_APP_KEY: 'NOT-A-REAL-KEY-NOT-A-REAL-KEY' } as Env;
const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

const call = (path: string, ua?: string) =>
  worker.fetch(
    new Request(`https://example.test${path}`, { headers: ua ? { 'User-Agent': ua } : {} }) as Request<
      unknown,
      IncomingRequestCfProperties
    >,
    env,
    ctx,
  );

const BOTS = [
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)',
  'GoogleOther',
  'AdsBot-Google (+http://www.google.com/adsbot.html)',
  'Mediapartners-Google',
  'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  'CCBot/2.0 (https://commoncrawl.org/faq/)',
  'Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)',
  'Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)',
  'facebookexternalhit/1.1',
  'python-requests/2.32.3',
  'Scrapy/2.11.0 (+https://scrapy.org)',
];

const PEOPLE = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  // A phone brand with "bot" in its name.
  'Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  'Bun/1.3.0',
];

describe('isBot', () => {
  it.each(BOTS)('flags %s', (ua) => expect(isBot(ua)).toBe(true));
  it.each(PEOPLE)('lets through %s', (ua) => expect(isBot(ua)).toBe(false));
  it('lets through a missing user agent', () => expect(isBot(null)).toBe(false));
});

describe('bot requests to the API', () => {
  it('are refused before any work', async () => {
    const res = await call('/api/health', BOTS[0]);
    expect(res.status).toBe(403);
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  it('people still get through, told not to index', async () => {
    const res = await call('/api/health', PEOPLE[0]);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });
});

describe('static site', () => {
  it('robots.txt disallows everything', () => {
    expect(readFileSync('public/robots.txt', 'utf8')).toMatch(/User-agent: \*\s+Disallow: \/\s*$/);
  });

  it('every page is marked noindex', () => {
    expect(readFileSync('public/_headers', 'utf8')).toMatch(/^\/\*\n(?: {2}.+\n)* {2}X-Robots-Tag: noindex, nofollow$/m);
  });
});
