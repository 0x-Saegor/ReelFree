// A02: app mode (docs/SPEC-iOS.md, "Bridge JS ↔ natif"). A fake window.webkit.messageHandlers.reelfree
// records every message; window.RF_CONFIG is set before the script, like the app's config script.
import { test, expect, open, state, waitPath } from './harness.mjs';

const THREAD = '/direct/t/FAKETHREAD/';
const SHARED_REEL = '/reel/FAKEDMREEL1/';
const TOKEN_KEY = 'reelfree:dm-allow';

function fakeApp(rfConfig) {
  return `
    window.__rfMsgs = [];
    window.webkit = { messageHandlers: { reelfree: { postMessage(m) { window.__rfMsgs.push(JSON.parse(JSON.stringify(m))); } } } };
    window.RF_CONFIG = ${JSON.stringify({ platform: 'ios-app', ...rfConfig })};
  `;
}

const msgs = (page) => page.evaluate(() => window.__rfMsgs);
const native = (page, msg) => page.evaluate((m) => window.reelfree.onNative(m), msg);
const session = (page) => page.evaluate((k) => sessionStorage.getItem(k), TOKEN_KEY);

test.use({ extraRoutes: { '^/direct/t/': 'dm-thread-legacy.html', '^/$': 'feed-following.html' } });
test.afterEach(async ({ page }) => { expect(page.__rfErrors.map(String)).toEqual([]); });

test.describe('app mode', () => {
  test.use({ preInit: [fakeApp({})], spa: true });

  test('ready and route messages are posted; window.reelfree is frozen', async ({ page }) => {
    await open(page, THREAD);
    const m = await msgs(page);
    expect(m).toContainEqual({ type: 'ready', script: 'instagram', version: expect.stringMatching(/^\d+\.\d+\.\d+$/) });
    expect(m).toContainEqual({ type: 'route', path: THREAD });
    await page.evaluate(() => window.__spa.go('/someuser/'));
    await waitPath(page, '/someuser/');
    expect(await msgs(page)).toContainEqual({ type: 'route', path: '/someuser/' });
    expect(await page.evaluate(() => {
      try { window.reelfree = null; } catch { /* strict */ }
      return typeof window.reelfree.onNative === 'function' && Object.isFrozen(window.reelfree);
    })).toBe(true);
    for (const x of await msgs(page)) expect(['ready', 'route', 'dmReelOpen', 'error']).toContain(x.type);
    expect((await msgs(page)).filter((x) => x.type === 'error')).toEqual([]);
  });

  test('history traversal posts route with via: "popstate" (Avenant 2); pushState does not', async ({ page }) => {
    await open(page, THREAD);
    await page.evaluate(() => window.__spa.go('/someuser/'));
    await waitPath(page, '/someuser/');
    await page.evaluate(() => history.back());
    await waitPath(page, THREAD);
    const routes = (await msgs(page)).filter((x) => x.type === 'route');
    expect(routes).toContainEqual({ type: 'route', path: '/someuser/' });
    expect(routes[routes.length - 1]).toEqual({ type: 'route', path: THREAD, via: 'popstate' });
    expect(routes.filter((x) => x.via).length).toBe(1);
  });

  test('a click on a shared reel posts dmReelOpen, keeps the token in memory, and is admitted', async ({ page }) => {
    await open(page, THREAD);
    await page.click(`a[href="${SHARED_REEL}"]`);
    await waitPath(page, SHARED_REEL);
    expect(await msgs(page)).toContainEqual({ type: 'dmReelOpen', id: 'FAKEDMREEL1' });
    expect((await state(page)).mode).toBe('dm-reel');
    expect(await session(page), 'no sessionStorage token in app mode').toBeNull();
  });

  test('a tap on a shared media posts dmReelOpen (no-href fallback)', async ({ page }) => {
    await open(page, THREAD);
    await page.evaluate(() => document.querySelector('a[href="/p/FAKEDMPOST1/"] img')
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch' })));
    expect(await msgs(page)).toContainEqual({ type: 'dmReelOpen', id: 'FAKEDMPOST1' });
  });

  test('dmReelDenied drops the local permission: the reel is refused', async ({ page }) => {
    await open(page, THREAD);
    await page.evaluate((href) => {
      const a = document.querySelector(`a[href="${href}"]`);
      a.addEventListener('click', (e) => e.preventDefault(), { once: true });
      a.click();
    }, SHARED_REEL);
    await native(page, { type: 'dmReelDenied', id: 'FAKEDMREEL1' });
    await page.evaluate((to) => window.__spa.go(to), SHARED_REEL);
    await expect.poll(async () => (await state(page)).path, { timeout: 5000 }).toBe(THREAD);
  });

  test('config message switches the feed off, then back on', async ({ page }) => {
    await open(page, '/?variant=following');
    expect((await state(page)).mode).toBe('feed');
    await native(page, { type: 'config', config: { feedMode: 'off' } });
    await expect.poll(async () => (await state(page)).mode).toBe('feed-off');
    await native(page, { type: 'config', config: { feedMode: 'limited' } });
    await expect.poll(async () => (await state(page)).mode).toBe('feed');
  });

  test('config message enabling blockExplore redirects away from Explore', async ({ page }) => {
    await native(page, { type: 'noop' }).catch(() => {});   // page not loaded yet: ignored
    await open(page, '/explore/search/');
    await native(page, { type: 'config', config: { blockExplore: false } });
    await page.evaluate(() => window.__spa.go('/explore/tags/x/'));
    await waitPath(page, '/explore/tags/x/');
    expect((await state(page)).mode).toBe('explore');
    await native(page, { type: 'config', config: { blockExplore: true } });
    await expect.poll(async () => (await state(page)).path, { timeout: 5000 }).toBe('/');
  });

  test('malformed native messages are ignored', async ({ page }) => {
    await open(page, '/?variant=following');
    for (const m of [null, 42, 'config', {}, { type: 'config' }, { type: 'config', config: { feedMode: 'x', feedLimit: -3 } },
      { type: 'dmReelDenied' }, { type: 'dmReelGranted', id: '../x' }, { type: 'unknown' }]) {
      await native(page, m);
    }
    expect((await state(page)).mode).toBe('feed');
    expect((await msgs(page)).filter((x) => x.type === 'error')).toEqual([]);
  });
});

const STORAGE_SPY = `
  window.__ssWrites = [];
  for (const fn of ['setItem', 'removeItem', 'clear']) {
    const orig = Storage.prototype[fn];
    Storage.prototype[fn] = function (...a) { window.__ssWrites.push(fn + ':' + (a[0] ?? '')); return orig.apply(this, a); };
  }
`;

// F6 (B05 review): in the app, no flag or counter goes to web storage; features still work.
test.describe('app mode — no web storage (F6)', () => {
  test.use({ preInit: [STORAGE_SPY, fakeApp({ feedLimit: 2 })], spa: true });

  test('feed variant redirect, feed cap and DM reel work without any sessionStorage write', async ({ page }) => {
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.evaluate(() => location.pathname + location.search).catch(() => ''), { timeout: 5000 })
      .toBe('/?variant=following');
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => document.documentElement.hasAttribute('data-rf-capped'))).toBe(true);
    const visible = await page.evaluate(() => Array.from(document.querySelectorAll('main article'))
      .filter((a) => a.getClientRects().length > 0).length);
    expect(visible).toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => window.__ssWrites)).toEqual([]);

    await open(page, THREAD);
    await page.click(`a[href="${SHARED_REEL}"]`);
    await waitPath(page, SHARED_REEL);
    expect((await state(page)).mode).toBe('dm-reel');
    expect(await page.evaluate(() => [window.__ssWrites, sessionStorage.length])).toEqual([[], 0]);
  });
});

test.describe('standalone mode — web storage (control for F6)', () => {
  test.use({ preInit: [STORAGE_SPY], config: { feedLimit: 2 } });

  test('standalone still keeps its counters in sessionStorage', async ({ page }) => {
    await open(page, '/?variant=following');
    const writes = await page.evaluate(() => window.__ssWrites);
    expect(writes).toContain('setItem:reelfree:feed-count');
    expect(writes.every((w) => /^(setItem|removeItem):reelfree:/.test(w))).toBe(true);
  });
});

test.describe('app mode — RF_CONFIG', () => {
  test.use({ preInit: [fakeApp({ blockExplore: false, feedMode: 'off', feedLimit: 'x' })] });

  test('RF_CONFIG is applied at start (valid keys only)', async ({ page }) => {
    await open(page, '/explore/tags/x/');
    expect(await state(page)).toMatchObject({ path: '/explore/tags/x/', mode: 'explore', mask: 'ok' });
    await open(page, '/?variant=following');
    expect((await state(page)).mode).toBe('feed-off');
  });
});

test.describe('standalone mode', () => {
  test.use({ preInit: ['window.RF_CONFIG = { blockExplore: false };'] });

  test('without window.webkit: no window.reelfree, RF_CONFIG ignored, sessionStorage token', async ({ page }) => {
    await open(page, THREAD);
    expect(await page.evaluate(() => typeof window.reelfree)).toBe('undefined');
    await page.evaluate((href) => {
      const a = document.querySelector(`a[href="${href}"]`);
      a.addEventListener('click', (e) => e.preventDefault(), { once: true });
      a.click();
    }, SHARED_REEL);
    expect(await session(page)).toMatch(/^FAKEDMREEL1:\d+$/);
    await open(page, '/explore/tags/x/');
    await expect.poll(async () => (await state(page)).path, { timeout: 5000 }).toBe('/');
  });
});
