// B03: web/youtube.js on a synthetic m.youtube.com page — Shorts hidden, /shorts/<id> -> /watch?v=<id>,
// optional home feed hiding, bridge messages in app mode. No real network: every request is served
// from disk or aborted.
import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '../../web/youtube.js');
const PAGE = path.join(HERE, 'pages/yt-home.html');
const YT = 'https://m.youtube.com';

function fakeApp(rfConfig) {
  return `
    window.__rfMsgs = [];
    window.webkit = { messageHandlers: { reelfree: { postMessage(m) { window.__rfMsgs.push(JSON.parse(JSON.stringify(m))); } } } };
    window.RF_CONFIG = ${JSON.stringify({ platform: 'ios-app', ...rfConfig })};
  `;
}

const test = base.extend({
  preInit: [[], { option: true }],
  page: async ({ page, preInit }, use) => {
    for (const s of preInit) await page.addInitScript({ content: s });
    await page.addInitScript({ content: fs.readFileSync(SRC, 'utf8') + '\n//# sourceURL=youtube.js' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.route('**/*', (route) => {
      const req = route.request();
      if (new URL(req.url()).origin === YT && req.resourceType() === 'document') {
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(PAGE) });
      }
      return route.abort('blockedbyclient');
    });
    await use(page);
    expect(errors).toEqual([]);
  },
});

async function open(page, p) {
  await page.goto(YT + p, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(350);
}
// Current path + query; '(navigating)' while a redirect destroys the execution context.
const loc = (page) => page.evaluate(() => location.pathname + location.search).catch(() => '(navigating)');
const attr = (page, n) => page.evaluate((a) => document.documentElement.getAttribute(a), n);
const shown = (page, sel) => page.locator(sel).evaluate((el) => el.getClientRects().length > 0);

test('home: Shorts shelf, Short items, Shorts chip and pivot item hidden; videos visible', async ({ page }) => {
  await open(page, '/');
  expect(await attr(page, 'data-reelfree')).toBe('ok');
  expect(await shown(page, '#video-1')).toBe(true);
  expect(await shown(page, '#pivot-home')).toBe(true);
  for (const sel of ['#shorts-shelf', '#video-short', '#chip-shorts', '#pivot-shorts']) {
    expect(await shown(page, sel), `${sel} should be hidden`).toBe(false);
  }
});

test('/shorts/<id> document load lands on /watch?v=<id>', async ({ page }) => {
  await open(page, '/shorts/BBBBBBBBBBB');
  await expect.poll(() => loc(page)).toBe('/watch?v=BBBBBBBBBBB');
});

test('/feed/shorts and channel Shorts tab are redirected', async ({ page }) => {
  await open(page, '/feed/shorts');
  await expect.poll(() => loc(page)).toBe('/');
  await open(page, '/@someone/shorts');
  await expect.poll(() => loc(page)).toBe('/@someone');
});

test('SPA navigation to a Short is masked then redirected', async ({ page }) => {
  await open(page, '/');
  await page.evaluate(() => window.__spa.go('/shorts/CCCCCCCCCCC'));
  await expect.poll(() => loc(page), { timeout: 5000 }).toBe('/watch?v=CCCCCCCCCCC');
});

test('encoded path tricks stay masked', async ({ page }) => {
  await open(page, '/shorts%2FBBBBBBBBBBB');
  expect(await attr(page, 'data-reelfree')).toBe('mask');
});

test.describe('app mode', () => {
  test.use({ preInit: [fakeApp({ ytHideHomeFeed: true, feedMode: 'off' })] });

  test('RF_CONFIG.ytHideHomeFeed hides the home grid; ready/route posted; config message restores it', async ({ page }) => {
    await open(page, '/');
    expect(await attr(page, 'data-rfy-mode')).toBe('home-off');
    expect(await shown(page, '#home-grid')).toBe(false);
    const m = await page.evaluate(() => window.__rfMsgs);
    expect(m).toContainEqual({ type: 'ready', script: 'youtube', version: expect.stringMatching(/^\d+\.\d+\.\d+$/) });
    expect(m).toContainEqual({ type: 'route', path: '/' });
    expect(m.filter((x) => x.type === 'error')).toEqual([]);
    for (const bad of [null, { type: 'config', config: { ytHideHomeFeed: 'no' } }, { type: 'dmReelGranted', id: 'x' }]) {
      await page.evaluate((b) => window.reelfree.onNative(b), bad);
    }
    expect(await attr(page, 'data-rfy-mode')).toBe('home-off');
    await page.evaluate(() => window.reelfree.onNative({ type: 'config', config: { ytHideHomeFeed: false } }));
    await expect.poll(() => attr(page, 'data-rfy-mode')).toBe('home');
    expect(await shown(page, '#home-grid')).toBe(true);
  });
});

const STORAGE_SPY = `
  window.__ssWrites = [];
  for (const fn of ['setItem', 'removeItem', 'clear']) {
    const orig = Storage.prototype[fn];
    Storage.prototype[fn] = function (...a) { window.__ssWrites.push(fn + ':' + (a[0] ?? '')); return orig.apply(this, a); };
  }
`;

test.describe('app mode — no web storage (F6)', () => {
  test.use({ preInit: [STORAGE_SPY, fakeApp({})] });

  test('/shorts/<id> is redirected without any sessionStorage write', async ({ page }) => {
    await open(page, '/shorts/BBBBBBBBBBB');
    await expect.poll(() => loc(page)).toBe('/watch?v=BBBBBBBBBBB');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => [window.__ssWrites, sessionStorage.length])).toEqual([[], 0]);
  });
});

test.describe('standalone mode — web storage (control for F6)', () => {
  test.use({ preInit: [STORAGE_SPY] });

  test('standalone still writes the Shorts loop guard', async ({ page }) => {
    await open(page, '/shorts/BBBBBBBBBBB');
    await expect.poll(() => loc(page)).toBe('/watch?v=BBBBBBBBBBB');
    expect(await page.evaluate(() => sessionStorage.getItem('reelfree:yt-shorts-at'))).toMatch(/^BBBBBBBBBBB:\d+$/);
  });
});

test.describe('app mode — history', () => {
  test.use({ preInit: [fakeApp({})] });

  test('history traversal posts route with via: "popstate" (Avenant 2)', async ({ page }) => {
    await open(page, '/');
    await page.evaluate(() => window.__spa.go('/feed/subscriptions'));
    await expect.poll(() => page.evaluate(() => window.__rfMsgs.filter((x) => x.type === 'route').length)).toBe(2);
    await page.evaluate(() => history.back());
    await expect.poll(() => page.evaluate(() => window.__rfMsgs.filter((x) => x.type === 'route').pop()))
      .toEqual({ type: 'route', path: '/', via: 'popstate' });
    const routes = await page.evaluate(() => window.__rfMsgs.filter((x) => x.type === 'route'));
    expect(routes[1]).toEqual({ type: 'route', path: '/feed/subscriptions' });
  });
});

test.describe('standalone mode', () => {
  test.use({ preInit: ['window.RF_CONFIG = { ytHideHomeFeed: true };'] });

  test('without window.webkit: RF_CONFIG ignored, no window.reelfree', async ({ page }) => {
    await open(page, '/');
    expect(await attr(page, 'data-rfy-mode')).toBe('home');
    expect(await page.evaluate(() => typeof window.reelfree)).toBe('undefined');
  });
});
