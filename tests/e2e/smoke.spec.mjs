// Harness smoke tests (T07) + first route checks. Full per-requirement E2E coverage is T15.
import { test, expect, open, state, spaNavigate, foreignRequests } from './harness.mjs';

test.use({ fixturePage: 'shell.html' });

test.describe('harness', () => {
  test.use({ injectUserscript: false });

  test('emulates iPhone 11 in WebKit', async ({ page, browserName }) => {
    expect(browserName).toBe('webkit');
    await open(page, '/');
    const env = await page.evaluate(() => ({
      w: innerWidth, h: innerHeight, dpr: devicePixelRatio,
      ua: navigator.userAgent, touch: 'ontouchstart' in window, host: location.host,
    }));
    expect(env).toMatchObject({ w: 414, dpr: 2, touch: true, host: 'www.instagram.com' });
    expect(env.ua).toMatch(/iPhone/);
  });
});

test.describe('userscript injection', () => {
  test('runs at document-start without errors', async ({ page }) => {
    await open(page, '/');
    expect(page.__rfErrors.map(String)).toEqual([]);
    expect(await page.locator('#reelfree-style').count()).toBe(1);
  });

  test('zero network: the script makes no request at all', async ({ page, requests }) => {
    await open(page, '/');
    await spaNavigate(page, '/direct/inbox/');
    await spaNavigate(page, '/someuser/');
    expect(foreignRequests(requests)).toEqual([]);
  });
});

test.describe('routes (smoke)', () => {
  test('home feed is unmasked', async ({ page }) => {
    await open(page, '/');
    expect(await state(page)).toMatchObject({ path: '/', mask: 'ok', bodyVisible: true });
  });

  test('R1 — Reels tab is hidden', async ({ page }) => {
    await open(page, '/');
    await expect(page.locator('a[href="/reels/"]')).toBeHidden();
  });

  test('R2 — /reels/ loaded directly redirects to /', async ({ page }) => {
    await open(page, '/reels/');
    await expect.poll(async () => (await state(page)).path).toBe('/');
    expect((await state(page)).mask).toBe('ok');
  });

  test('R2 — /reels/ reached via SPA navigation is masked then redirected', async ({ page }) => {
    await open(page, '/');
    await spaNavigate(page, '/reels/');
    await expect.poll(async () => (await state(page)).path).toBe('/');
  });

  test('R3 — /reel/<id>/ outside DM redirects to /', async ({ page }) => {
    await open(page, '/reel/ABC123/');
    await expect.poll(async () => (await state(page)).path).toBe('/');
  });

  test('R5 — /explore/ redirects to /', async ({ page }) => {
    await open(page, '/explore/');
    await expect.poll(async () => (await state(page)).path).toBe('/');
  });
});
