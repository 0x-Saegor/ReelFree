// Router (X1), fail-closed (X3), Explore/search (R5) and class-independence (X2) E2E tests.
// Complements smoke.spec.mjs (which covers the basic R2/R3/R5 redirects of a direct load / SPA push).
import { test, expect, open, state, waitPath, holdDocument, isShown, spaNavigate, IG } from './harness.mjs';

// --- local helpers -----------------------------------------------------------

function expectNoErrors(page) {
  expect(page.__rfErrors.map(String)).toEqual([]);
}

// scriptTransform that inserts `add` right after `needle`, and fails loudly if the needle is gone.
// Returned as a fixture function: Playwright would otherwise treat a bare function value as a fixture.
function injectAfter(needle, add) {
  const fn = (src) => {
    if (!src.includes(needle)) throw new Error(`scriptTransform: needle not found in userscript: ${needle}`);
    const out = src.replace(needle, needle + add);
    if (out === src) throw new Error('scriptTransform: replacement did not happen');
    return out;
  };
  return async ({}, use) => { await use(fn); };
}

// Records the pathname of every document request (page 'request' events: unlike the harness's
// `requests` fixture, this also sees requests swallowed by holdDocument's route).
function trackDocs(page) {
  const docs = [];
  page.on('request', (r) => { if (r.resourceType() === 'document') docs.push(new URL(r.url()).pathname); });
  return docs;
}

// Asserts the userscript issued a document request for `pathname` (its redirect).
async function expectDocRequested(docs, pathname, timeout = 3000) {
  await expect.poll(() => docs.includes(pathname), { timeout }).toBe(true);
}

// Loads a forbidden path while its redirect target is held: the page stays on the forbidden route.
async function gotoHeld(page, p) {
  await page.goto(IG + p, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(100);
}

// Number of elements matching `sel` that are rendered. Uses page.evaluate rather than locators:
// locator calls block while a navigation is pending (holdDocument), page.evaluate does not.
async function shownCount(page, sel) {
  return page.evaluate((sel) => [...document.querySelectorAll(sel)]
    .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden').length, sel);
}

async function attr(page) {
  return page.evaluate(() => document.documentElement.getAttribute('data-reelfree'));
}

// =============================================================================
// X1 — SPA route detection (synthetic shell)
// =============================================================================
test.describe('X1 — SPA router', () => {
  test.use({ fixturePage: 'shell.html' });

  test('X1 — hooked pushState to /reels/ masks synchronously, then lands on /', async ({ page }) => {
    await open(page, '/');
    expect((await state(page)).mask).toBe('ok');
    const sync = await page.evaluate(() => {
      history.pushState({}, '', '/reels/');
      return {
        mask: document.documentElement.getAttribute('data-reelfree'),
        display: getComputedStyle(document.body).display,
      };
    });
    expect(sync).toEqual({ mask: 'mask', display: 'none' });
    await waitPath(page, '/');
    expect((await state(page)).mask).toBe('ok');
    expectNoErrors(page);
  });

  test('X1 — hooked replaceState to /explore/ masks synchronously, then lands on /', async ({ page }) => {
    await open(page, '/');
    const sync = await page.evaluate(() => {
      history.replaceState({}, '', '/explore/');
      return {
        mask: document.documentElement.getAttribute('data-reelfree'),
        display: getComputedStyle(document.body).display,
      };
    });
    expect(sync).toEqual({ mask: 'mask', display: 'none' });
    await waitPath(page, '/');
    expect((await state(page)).mask).toBe('ok');
    expectNoErrors(page);
  });

  test('X1 — popstate back to /reels/ is masked before page listeners run, then lands on /', async ({ page }) => {
    await open(page, '/');
    await page.evaluate(() => {
      sessionStorage.removeItem('test:pop');
      // History entry for /reels/ created behind the hook's back, immediately covered by an allowed route.
      History.prototype.pushState.call(history, {}, '', '/reels/');
      history.pushState({}, '', '/direct/inbox/');
      // Page-level (non-capture) listener: what Instagram's router would see.
      window.addEventListener('popstate', () => {
        sessionStorage.setItem('test:pop', JSON.stringify({
          path: location.pathname,
          mask: document.documentElement.getAttribute('data-reelfree'),
          display: getComputedStyle(document.body).display,
        }));
      });
    });
    expect(await state(page)).toMatchObject({ path: '/direct/inbox/', mask: 'ok' });
    await page.evaluate(() => history.back());
    await waitPath(page, '/');
    const seen = await page.evaluate(() => JSON.parse(sessionStorage.getItem('test:pop') || 'null'));
    expect(seen).toEqual({ path: '/reels/', mask: 'mask', display: 'none' });
    expect((await state(page)).mask).toBe('ok');
    expectNoErrors(page);
  });

  test('X1 — polling fallback: unhooked pushState to /reels/ is masked and redirected within 500 ms', async ({ page }) => {
    await open(page, '/');
    await holdDocument(page, '/');   // registered after the initial load: only the redirect is held
    const docs = trackDocs(page);
    const t0 = Date.now();
    await page.evaluate(() => { History.prototype.pushState.call(history, {}, '', '/reels/'); });
    await expect.poll(() => attr(page), { timeout: 500, intervals: [20] }).toBe('mask');
    await expectDocRequested(docs, '/', 500);
    expect(Date.now() - t0).toBeLessThan(600);
    expect(await state(page)).toMatchObject({ path: '/reels/', mask: 'mask', bodyVisible: false });
    expectNoErrors(page);
  });

  test('X1 — allowed SPA transitions stay unmasked without redirect', async ({ page, requests }) => {
    await open(page, '/');
    const docsBefore = requests.filter((r) => r.type === 'document').length;
    for (const p of ['/direct/inbox/', '/someuser/', '/p/ABC/']) {
      await spaNavigate(page, p);
      expect(await state(page)).toMatchObject({ path: p, mask: 'ok', bodyVisible: true });
    }
    expect(requests.filter((r) => r.type === 'document').length).toBe(docsBefore);
    expectNoErrors(page);
  });
});

// =============================================================================
// X3 — fail-closed (rf-recon fixtures)
// =============================================================================
test.describe('X3 — fail-closed while the redirect is pending', () => {
  const cases = [
    ['/reels/', '/'],
    ['/reel/ABC/', '/'],
    ['/explore/', '/'],
    ['/reels/audio/123/', '/'],
    ['/REELS/', '/'],
    ['/reels;x/', '/'],
    ['/someuser/reels/', '/someuser/'],
    ['/reels/foo/bar/', '/'],
  ];
  for (const [from, to] of cases) {
    test(`X3 — ${from} stays masked while the redirect to ${to} is in flight`, async ({ page }) => {
      const docs = trackDocs(page);
      await holdDocument(page, to);
      await gotoHeld(page, from);
      await expectDocRequested(docs, to);
      const s = await state(page);
      expect(s.mask).toBe('mask');
      expect(s.bodyVisible).toBe(false);
      for (const sel of ['main', 'video', 'article', 'a[href]']) expect(await shownCount(page, sel), `${sel} shown`).toBe(0);
      expectNoErrors(page);
    });
  }

  test.describe('first paint', () => {
    test.use({
      preInit: [`
        (function () {
          window.__rfFirst = null;
          document.addEventListener('DOMContentLoaded', function () {
            window.__rfFirst = {
              mask: document.documentElement.getAttribute('data-reelfree'),
              display: getComputedStyle(document.body).display
            };
          }, true);
        })();
      `],
    });

    test('X3 — the mask is in place at the very first paint of /reels/', async ({ page }) => {
      await holdDocument(page, '/');
      await gotoHeld(page, '/reels/');
      // DOMContentLoaded listener registered (capture) before the userscript: earliest point a parsed
      // body can be rendered from the page's point of view.
      expect(await page.evaluate(() => window.__rfFirst)).toEqual({ mask: 'mask', display: 'none' });
      expectNoErrors(page);
    });
  });

  test.describe('exception in decide()', () => {
    test.use({ scriptTransform: injectAfter('function decide(path, ctx) {', ' throw new Error("boom");') });

    test('X3 — an exception in decide() keeps / masked', async ({ page }) => {
      await open(page, '/');
      expect(await state(page)).toMatchObject({ mask: 'mask', bodyVisible: false });
    });
  });

  test.describe('exception in onRouteAllowed()', () => {
    test.use({ scriptTransform: injectAfter('function onRouteAllowed() {', ' throw new Error("boom");') });

    test('X3 — an exception in onRouteAllowed() keeps / masked', async ({ page }) => {
      await open(page, '/');
      await page.waitForTimeout(300);
      expect(await state(page)).toMatchObject({ path: '/', mask: 'mask', bodyVisible: false });
    });
  });

  test('X3 — tampering with the mask attribute or the style is reverted', async ({ page }) => {
    await holdDocument(page, '/');
    await gotoHeld(page, '/reels/');
    expect(await attr(page)).toBe('mask');

    await page.evaluate(() => document.documentElement.removeAttribute('data-reelfree'));
    await expect.poll(() => attr(page), { timeout: 300, intervals: [20] }).toBe('mask');

    await page.evaluate(() => document.documentElement.setAttribute('data-reelfree', 'ok'));
    await expect.poll(() => attr(page), { timeout: 300, intervals: [20] }).toBe('mask');

    await page.evaluate(() => document.getElementById('reelfree-style').remove());
    await expect.poll(() => page.evaluate(() => document.querySelectorAll('#reelfree-style').length),
      { timeout: 500, intervals: [20] }).toBe(1);
    expect(await state(page)).toMatchObject({ path: '/reels/', mask: 'mask', bodyVisible: false });
    expectNoErrors(page);
  });

  test.describe('sessionStorage unavailable', () => {
    test.use({
      preInit: [`
        Object.defineProperty(window, 'sessionStorage', {
          configurable: true,
          get: function () { throw new DOMException('denied', 'SecurityError'); }
        });
      `],
    });

    test('X3 — without sessionStorage, / works and /reel/ABC/ is still blocked', async ({ page }) => {
      await open(page, '/');
      const throws = await page.evaluate(() => { try { void window.sessionStorage; return false; } catch { return true; } });
      expect(throws).toBe(true);
      expect(await state(page)).toMatchObject({ path: '/', mask: 'ok', bodyVisible: true });

      const docs = trackDocs(page);
      await holdDocument(page, '/');
      await gotoHeld(page, '/reel/ABC/');
      await expectDocRequested(docs, '/');
      expect(await state(page)).toMatchObject({ path: '/reel/ABC/', mask: 'mask', bodyVisible: false });
      expectNoErrors(page);
    });
  });
});

// =============================================================================
// R5 — Explore: account search allowed, grid hidden
// =============================================================================
test.describe('R5 — Explore / search', () => {
  test('R5 — /explore/search/ is allowed and its post tiles are hidden', async ({ page }) => {
    await open(page, '/explore/search/');
    expect(await state(page)).toMatchObject({ path: '/explore/search/', mask: 'ok', mode: 'search', bodyVisible: true });
    // Tile injected inside main > nav too (not covered by the "nav ~ *" rule).
    await page.evaluate(() => {
      const a = document.createElement('a');
      a.href = '/p/INJECTED1/';
      a.textContent = 'tile';
      (document.querySelector('main > nav') || document.querySelector('main')).appendChild(a);
    });
    await page.waitForTimeout(200);
    const tiles = page.locator('main a[href*="/p/"]');
    const n = await tiles.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) expect(await isShown(tiles.nth(i)), `tile ${i} visible`).toBe(false);
    await expect(page.locator('input[placeholder="Rechercher"]')).toBeVisible();
    expectNoErrors(page);
  });

  test('R5 — the Explore tab leads to /explore/search/, not the grid', async ({ page, requests }) => {
    await open(page, '/');
    await page.locator('a[href="/explore/"]').first().click();
    await waitPath(page, '/explore/search/');
    expect(await state(page)).toMatchObject({ mask: 'ok', mode: 'search' });
    const docs = requests.filter((r) => r.type === 'document').map((r) => new URL(r.url).pathname);
    expect(docs).not.toContain('/explore/');
    expectNoErrors(page);
  });

  test('R5 — /explore/tags/x/ is redirected to /', async ({ page }) => {
    await open(page, '/explore/tags/x/');
    await waitPath(page, '/');
    expect((await state(page)).mask).toBe('ok');
    expectNoErrors(page);
  });
});

// =============================================================================
// X2 — no dependency on CSS classes
// =============================================================================
test.describe('X2 — class-independent selectors', () => {
  test('X2 — stripping every class keeps the Reels tab and feed reels hidden', async ({ page }) => {
    await open(page, '/');
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('*')) el.setAttribute('class', 'x78zum5 xdt5ytf');
      for (const el of document.querySelectorAll('[class]')) el.removeAttribute('class');
      // Fresh nodes (no data-reelfree-* flags) so the script must re-detect everything.
      const main = document.querySelector('main');
      const copy = main.cloneNode(true);
      for (const el of copy.querySelectorAll('*')) {
        for (const a of [...el.attributes]) if (a.name.startsWith('data-reelfree')) el.removeAttribute(a.name);
      }
      main.replaceWith(copy);
    });
    await page.waitForTimeout(400);
    expect(await page.locator('[class]').count()).toBe(0);

    const tabs = page.locator('a[href="/reels/"]');
    expect(await tabs.count()).toBeGreaterThan(0);
    for (let i = 0; i < await tabs.count(); i++) expect(await isShown(tabs.nth(i)), `reels tab ${i}`).toBe(false);

    const reelArticles = page.locator('main article').filter({
      has: page.locator('a[href*="/reel/"], a[href*="/reels/"]:not([href*="/reels/audio/"])'),
    });
    expect(await reelArticles.count()).toBeGreaterThan(0);
    for (let i = 0; i < await reelArticles.count(); i++) {
      expect(await isShown(reelArticles.nth(i)), `reel article ${i}`).toBe(false);
    }
    expect(await state(page)).toMatchObject({ mask: 'ok', bodyVisible: true });
    expectNoErrors(page);
  });
});
