// A01 non-regression: the four major bypasses found by rf-sec (board/archive/rf-sec.md, T16 review).
//   1. D3 via /p/: from an admitted DM reel, an SPA move to another media served as /p/<id>/.
//   2. D2 via history: the tap fallback must be bound to the tapped media and ignored on popstate.
//   3. S1 reset: a DM <-> feed round trip (SPA or full navigation) must not reset the feed cap.
//   4. Photo overlay: a dialog over a thread locks scrolling and never yields a token, video or not.
import { test, expect, open, state, waitPath, dispatchPrevented } from './harness.mjs';

const THREAD = '/direct/t/FAKETHREAD/';
const SHARED_REEL = '/reel/FAKEDMREEL1/';   // tests/e2e/pages/dm-thread-legacy.html
const TOKEN_KEY = 'reelfree:dm-allow';

const LIMIT = 2;   // feed-following.html holds at least 2 counted photos (feed.spec.mjs uses the same)
test.use({ extraRoutes: { '^/direct/t/': 'dm-thread-legacy.html', '^/$': 'feed-following.html' } });
test.afterEach(async ({ page }) => { expect(page.__rfErrors.map(String)).toEqual([]); });

async function safeState(page) {
  try { return await state(page); } catch { return { path: '(navigating)' }; }
}

async function readSession(page, key) {
  for (let i = 0; i < 20; i++) {
    try { return await page.evaluate((k) => sessionStorage.getItem(k), key); } catch { await page.waitForTimeout(100); }
  }
  throw new Error('could not read sessionStorage');
}

// Waits for the path to settle on `p` (redirects included) and the userscript to process it.
async function settleOn(page, p) {
  await expect.poll(async () => (await safeState(page)).path, { timeout: 5000 }).toBe(p);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(400);
}

async function tapOn(page, selector) {
  await page.evaluate((sel) => {
    document.querySelector(sel).dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch' }));
  }, selector);
}

test.describe('A01 — SPA', () => {
  test.use({ spa: true });

  test('1. D3 via /p/ — from an admitted DM reel, SPA navigation to another /p/ returns to the thread', async ({ page }) => {
    await open(page, THREAD);
    await page.click(`a[href="${SHARED_REEL}"]`);
    await settleOn(page, SHARED_REEL);
    expect((await state(page)).mode).toBe('dm-reel');

    await page.evaluate(() => window.__spa.go('/p/OTHERMEDIA1/'));
    await settleOn(page, THREAD);
    expect((await state(page)).mode).toBe('dm');
    expect(await readSession(page, TOKEN_KEY)).toBeNull();
  });

  test('2a. D2 fallback — a tap on another media does not admit the reel', async ({ page }) => {
    await open(page, THREAD);
    await tapOn(page, 'a[href="/p/FAKEDMPOST1/"] img');
    await page.evaluate((to) => window.__spa.go(to), SHARED_REEL);
    await settleOn(page, THREAD);
    expect(await readSession(page, TOKEN_KEY)).toBeNull();
  });

  test('2b. D2 fallback — history traversal (popstate) right after a tap never admits a media', async ({ page }) => {
    await open(page, THREAD);
    // The user saw the shared media as a plain post (video hidden), then went back to the thread.
    await page.evaluate(() => window.__spa.go('/p/FAKEDMREEL1/'));
    await waitPath(page, '/p/FAKEDMREEL1/');
    expect((await state(page)).mode).toBe('post');
    await page.evaluate((t) => window.__spa.go(t), THREAD);
    await waitPath(page, THREAD);
    // Tap on the shared media, then "Back" (popstate) lands on that media within the tap window.
    await tapOn(page, `a[href="${SHARED_REEL}"] video`);
    await page.evaluate(() => history.back());
    await waitPath(page, '/p/FAKEDMREEL1/');
    const s = await state(page);
    expect(s.mode, 'history traversal must not turn the tap into a token').toBe('post');
    expect(await readSession(page, TOKEN_KEY)).toBeNull();
  });

  test.describe('feed cap', () => {
    test.use({ config: { feedLimit: LIMIT } });

    test('3a. S1 — a feed -> DM -> feed SPA round trip keeps the counter', async ({ page }) => {
      await open(page, '/?variant=following');
      const count1 = Number(await readSession(page, 'reelfree:feed-count'));
      expect(count1).toBeGreaterThanOrEqual(LIMIT);
      expect(await page.evaluate(() => document.documentElement.hasAttribute('data-rf-capped'))).toBe(true);
      await page.evaluate((t) => window.__spa.go(t), THREAD);
      await waitPath(page, THREAD);
      await page.evaluate(() => window.__spa.go('/?variant=following'));
      await waitPath(page, '/');
      await page.waitForTimeout(400);
      expect(Number(await readSession(page, 'reelfree:feed-count'))).toBe(count1);
      expect(await page.evaluate(() => document.documentElement.hasAttribute('data-rf-capped'))).toBe(true);
      const shown = await page.evaluate(() => Array.from(document.querySelectorAll('main article'))
        .filter((a) => a.getClientRects().length > 0).length);
      expect(shown).toBeLessThanOrEqual(LIMIT);
    });
  });
});

test.describe('A01 — full navigation', () => {
  test.use({ config: { feedLimit: LIMIT } });

  test('3b. S1 — a feed -> DM -> feed round trip with document loads shows no new posts', async ({ page }) => {
    await open(page, '/?variant=following');
    const visible = () => page.evaluate(() => Array.from(document.querySelectorAll('main article'))
      .filter((a) => a.getClientRects().length > 0).length);
    expect(await visible()).toBe(LIMIT);
    await open(page, THREAD);
    await open(page, '/?variant=following');
    await settleOn(page, '/');
    expect(await page.evaluate(() => document.documentElement.hasAttribute('data-rf-capped'))).toBe(true);
    expect(await visible(), 'the cap is spent for this tab: no fresh batch after a round trip').toBe(0);
  });

  test('4. Photo overlay — a dialog without video locks vertical scroll and its links yield no token', async ({ page }) => {
    await open(page, THREAD);
    await page.evaluate(() => {
      const dlg = document.createElement('div');
      dlg.setAttribute('role', 'dialog');
      const img = document.createElement('img');
      img.alt = '';
      img.src = 'data:,';
      dlg.appendChild(img);
      for (const [id, href] of [['test-reel', '/reel/OTHER123/'], ['test-post', '/p/OTHER456/']]) {
        const a = document.createElement('a');
        a.id = id;
        a.href = href;
        a.textContent = id;
        dlg.appendChild(a);
      }
      document.body.appendChild(dlg);
    });
    await page.waitForTimeout(400);
    expect(await dispatchPrevented(page, 'wheel', { dy: 400 }), 'vertical wheel under a photo overlay').toBe(true);
    expect(await dispatchPrevented(page, 'touch', { dy: -300 }), 'vertical swipe under a photo overlay').toBe(true);
    for (const id of ['test-reel', 'test-post']) {
      await page.evaluate((i) => document.getElementById(i).click(), id);
      await page.waitForTimeout(300);
      expect((await state(page)).path, `click on #${id} must not navigate`).toBe(THREAD);
      expect(await readSession(page, TOKEN_KEY), `click on #${id} must not write a token`).toBeNull();
    }
  });
});
