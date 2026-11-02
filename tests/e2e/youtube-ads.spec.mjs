// D05: YouTube ads. web/youtube-ads.js (page world in the app) prunes adPlacements / playerAds / adSlots
// from ytInitialPlayerResponse and /youtubei/v1/player responses; web/youtube.js (isolated world)
// hides sponsored slots and skips a video ad that still shows (.ad-showing). Synthetic page
// tests/e2e/pages/yt-watch.html; no real network.
import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADS = fs.readFileSync(path.join(HERE, '../../web/youtube-ads.js'), 'utf8');
const YTJS = fs.readFileSync(path.join(HERE, '../../web/youtube.js'), 'utf8');
const PAGE = fs.readFileSync(path.join(HERE, 'pages/yt-watch.html'));
const YT = 'https://m.youtube.com';
const PLAYER_JSON = {
  playabilityStatus: { status: 'OK' }, videoDetails: { videoId: 'AAAAAAAAAAA' },
  adPlacements: [{}], playerAds: [{}], adSlots: [{}],
};
const FAKE_APP = `
  window.__rfMsgs = [];
  window.webkit = { messageHandlers: { reelfree: { postMessage(m) { window.__rfMsgs.push(JSON.parse(JSON.stringify(m))); } } } };
  window.RF_CONFIG = { platform: 'ios-app' };
`;

const test = base.extend({
  scripts: [['ads', 'yt'], { option: true }],
  origin: [YT, { option: true }],
  requests: async ({}, use) => { await use([]); },
  page: async ({ page, scripts, origin, requests }, use) => {
    await page.addInitScript({ content: FAKE_APP });
    if (scripts.includes('ads')) await page.addInitScript({ content: ADS + '\n//# sourceURL=youtube-ads.js' });
    if (scripts.includes('yt')) await page.addInitScript({ content: YTJS + '\n//# sourceURL=youtube.js' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.route('**/*', (route) => {
      const req = route.request();
      const u = new URL(req.url());
      requests.push(req.url());
      if (req.resourceType() === 'document') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE });
      if (/^\/youtubei\/v1\/(player|browse)/.test(u.pathname)) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PLAYER_JSON) });
      }
      return route.abort('blockedbyclient');
    });
    await use(page);
    expect(errors).toEqual([]);
  },
});

async function open(page, p = '/watch?v=AAAAAAAAAAA') {
  await page.goto(YT + p, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
}
const shown = (page, sel) => page.locator(sel).evaluate((el) => el.getClientRects().length > 0);

test.describe('youtube-ads.js — prune', () => {
  test.use({ scripts: ['ads'] });

  test('ytInitialPlayerResponse is pruned when the inline script assigns it; video data kept', async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => window.__seenAtLoad))
      .toEqual(['playabilityStatus', 'streamingData', 'videoDetails']);
    expect(await page.evaluate(() => window.ytInitialPlayerResponse.videoDetails.videoId)).toBe('AAAAAAAAAAA');
  });

  test('/youtubei/v1/player over fetch: ad keys removed, status and data kept', async ({ page }) => {
    await open(page);
    const r = await page.evaluate(async () => {
      const res = await fetch('/youtubei/v1/player?prettyPrint=false', { method: 'POST', body: '{}' });
      return { status: res.status, ok: res.ok, keys: Object.keys(await res.json()).sort() };
    });
    expect(r).toEqual({ status: 200, ok: true, keys: ['playabilityStatus', 'videoDetails'] });
  });

  test('other endpoints are untouched', async ({ page }) => {
    await open(page);
    const keys = await page.evaluate(async () => Object.keys(await (await fetch('/youtubei/v1/browse')).json()).sort());
    expect(keys).toEqual(['adPlacements', 'adSlots', 'playabilityStatus', 'playerAds', 'videoDetails']);
  });

  test('/youtubei/v1/player over XHR (JSON.parse): ad keys removed', async ({ page }) => {
    await open(page);
    const keys = await page.evaluate(() => new Promise((resolve) => {
      const x = new XMLHttpRequest();
      x.open('POST', '/youtubei/v1/player');
      x.onload = () => resolve(Object.keys(JSON.parse(x.responseText)).sort());
      x.send('{}');
    }));
    expect(keys).toEqual(['playabilityStatus', 'videoDetails']);
    // Ordinary JSON is never altered.
    expect(await page.evaluate(() => JSON.parse('{"adSlots":1,"x":2}'))).toEqual({ adSlots: 1, x: 2 });
  });

  test('no request of its own and no bridge use', async ({ page, requests }) => {
    await open(page);
    await page.waitForTimeout(300);
    expect(requests).toEqual([YT + '/watch?v=AAAAAAAAAAA']);
    expect(await page.evaluate(() => window.__rfMsgs)).toEqual([]);
    expect(await page.evaluate(() => typeof window.reelfree)).toBe('undefined');
  });
});

test.describe('youtube-ads.js — other hosts', () => {
  test.use({ scripts: ['ads'] });
  for (const origin of ['https://www.instagram.com', 'https://accounts.google.com', 'https://evilyoutube.com']) {
    test(`no-op on ${origin}`, async ({ page }) => {
      await page.goto(origin + '/watch', { waitUntil: 'domcontentloaded' });
      const r = await page.evaluate(() => ({
        keys: Object.keys(window.ytInitialPlayerResponse).length,
        fetchNative: /\[native code\]/.test(Function.prototype.toString.call(window.fetch)),
        parseNative: /\[native code\]/.test(Function.prototype.toString.call(JSON.parse)),
      }));
      expect(r).toEqual({ keys: 6, fetchNative: true, parseNative: true });
    });
  }
});

test.describe('youtube.js — ad fallback (isolated world)', () => {
  test.use({ scripts: ['yt'] });

  test('sponsored slots and the items that wrap them are hidden; regular items stay', async ({ page }) => {
    await open(page);
    expect(await shown(page, '#item-video')).toBe(true);
    for (const sel of ['#top-ad', '#item-ad', '#item-ad-d']) expect(await shown(page, sel), sel).toBe(false);
    // Added later (infinite feed) and recycled in place.
    await page.evaluate(() => document.getElementById('related').insertAdjacentHTML('beforeend',
      '<ytm-rich-item-renderer id="late-ad"><ytm-promoted-sparkles-web-renderer></ytm-promoted-sparkles-web-renderer></ytm-rich-item-renderer>'));
    await page.waitForTimeout(150);
    expect(await shown(page, '#late-ad')).toBe(false);
    await page.evaluate(() => document.querySelector('#late-ad ytm-promoted-sparkles-web-renderer').remove());
    await page.waitForTimeout(150);
    expect(await shown(page, '#late-ad')).toBe(true);
  });

  test('.ad-showing: muted, seeked to the end, Skip pressed; sound restored afterwards', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      const v = document.getElementById('vid');
      window.__seek = [];
      Object.defineProperty(v, 'duration', { configurable: true, get: () => 15 });
      Object.defineProperty(v, 'currentTime', { configurable: true, get: () => 2, set: (t) => window.__seek.push(t) });
      v.muted = false;
      window.__skips = 0;
      document.getElementById('skip').addEventListener('click', () => { window.__skips++; });
      document.getElementById('movie_player').classList.add('ad-showing');
    });
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => ({ muted: document.getElementById('vid').muted, seek: window.__seek, skips: window.__skips })))
      .toEqual({ muted: true, seek: [15], skips: 1 });
    await page.evaluate(() => document.getElementById('movie_player').classList.remove('ad-showing'));
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => document.getElementById('vid').muted)).toBe(false);
  });

  test('a user who had muted the video stays muted after the ad', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      document.getElementById('vid').muted = true;
      document.getElementById('movie_player').classList.add('ad-showing');
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => document.getElementById('movie_player').classList.remove('ad-showing'));
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => document.getElementById('vid').muted)).toBe(true);
  });

  test('no ad on screen: nothing is touched', async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => document.getElementById('vid').muted)).toBe(false);
  });
});
