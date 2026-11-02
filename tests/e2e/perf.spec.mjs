// D01: perf non-regression for web/instagram.js (tests/perf/bench.mjs has the measurements).
//  - no :has() in any injected CSS (costly on every mutation over Instagram's large DOM on iPhone);
//  - no setInterval in app mode: routes come from the app (onNative {type: "route"}, Avenant 4);
//  - mutation pass is incremental: added posts and links rewritten in place are still flagged.
import { test, expect, open, state, isShown } from './harness.mjs';

// Counts setInterval calls made after this point (the userscript runs after preInit).
const COUNT_INTERVALS = `
  window.__rfIntervals = 0;
  const si = window.setInterval;
  window.setInterval = function () { window.__rfIntervals++; return si.apply(window, arguments); };
`;
const FAKE_APP = `
  window.__rfMsgs = [];
  window.webkit = { messageHandlers: { reelfree: { postMessage(m) { window.__rfMsgs.push(JSON.parse(JSON.stringify(m))); } } } };
  window.RF_CONFIG = { platform: 'ios-app' };
`;

const injectedCss = (page) => page.evaluate(() =>
  [...document.querySelectorAll('style[id^="reelfree"]')].map((s) => s.textContent).join('\n'));

test.use({ extraRoutes: { '^/$': 'feed-following.html' } });
test.afterEach(async ({ page }) => { expect(page.__rfErrors.map(String)).toEqual([]); });

test.describe('app mode', () => {
  test.use({ preInit: [COUNT_INTERVALS, FAKE_APP] });

  test('no setInterval and no :has() in the injected CSS', async ({ page }) => {
    await open(page, '/?variant=following');
    expect((await state(page)).mode).toBe('feed');
    expect(await page.evaluate(() => window.__rfIntervals)).toBe(0);
    const css = await injectedCss(page);
    expect(css.length).toBeGreaterThan(100);
    expect(css).not.toContain(':has(');
  });

  test('a page pushState the script cannot hook is decided on onNative {type: "route"}', async ({ page }) => {
    await open(page, '/someuser/');
    // History.prototype bypasses the hook on window.history, like the page's own calls from the
    // main world when the script runs in an isolated world. No DOM mutation follows.
    await page.evaluate(() => History.prototype.pushState.call(history, {}, '', '/direct/inbox/'));
    await page.waitForTimeout(400);   // no polling: nothing happens on its own
    expect((await state(page)).mode).not.toBe('dm');
    await page.evaluate(() => window.reelfree.onNative({ type: 'route', path: '/direct/inbox/' }));
    expect((await state(page)).mode).toBe('dm');
    expect(await page.evaluate(() => window.__rfMsgs.filter((m) => m.type === 'route').pop()))
      .toEqual({ type: 'route', path: '/direct/inbox/' });
  });

  test('onNative route with via: "popstate" is reported as history traversal; malformed is ignored', async ({ page }) => {
    await open(page, '/someuser/');
    await page.evaluate(() => History.prototype.pushState.call(history, {}, '', '/direct/inbox/'));
    await page.evaluate(() => window.reelfree.onNative({ type: 'route' }));   // no path: ignored
    expect((await state(page)).mode).not.toBe('dm');
    await page.evaluate(() => window.reelfree.onNative({ type: 'route', path: '/direct/inbox/', via: 'popstate' }));
    expect((await state(page)).mode).toBe('dm');
    expect(await page.evaluate(() => window.__rfMsgs.filter((m) => m.type === 'route').pop()))
      .toEqual({ type: 'route', path: '/direct/inbox/', via: 'popstate' });
  });
});

test.describe('standalone mode (control)', () => {
  test.use({ preInit: [COUNT_INTERVALS] });

  test('keeps its polling fallback, still no :has()', async ({ page }) => {
    await open(page, '/?variant=following');
    expect(await page.evaluate(() => window.__rfIntervals)).toBe(1);
    expect(await injectedCss(page)).not.toContain(':has(');
  });
});

test.describe('incremental mutation pass', () => {
  test.use({ preInit: [FAKE_APP] });

  test('a reel post appended to the feed is hidden; a link rewritten in place too', async ({ page }) => {
    await open(page, '/?variant=following');
    await page.evaluate(() => {
      const parent = document.querySelector('main article').parentElement;
      const mk = (id, href) => {
        const a = document.createElement('article');
        a.id = id;
        const l = document.createElement('a');
        l.href = href;
        l.textContent = id;
        a.append(l, document.createElement('span'));
        parent.appendChild(a);
      };
      mk('perf-reel', '/reel/PERFREEL01/');
      mk('perf-photo', '/p/PERFPHOTO1/');
    });
    await page.waitForTimeout(150);
    expect(await isShown(page.locator('#perf-reel'))).toBe(false);
    expect(await isShown(page.locator('#perf-photo'))).toBe(true);
    // React recycles nodes: the same <a> now points at a reel.
    await page.evaluate(() => document.querySelector('#perf-photo a').setAttribute('href', '/reel/PERFREEL02/'));
    await page.waitForTimeout(150);
    expect(await isShown(page.locator('#perf-photo'))).toBe(false);
  });

  test('G2: the page stripping our flags from a reel post or the Reels item does not unhide them', async ({ page }) => {
    await open(page, '/?variant=following');
    await page.evaluate(() => {
      const parent = document.querySelector('main article').parentElement;
      const a = document.createElement('article');
      a.id = 'g2-reel';
      a.innerHTML = '<a href="/reel/G2REEL0001/">r</a><span></span>';
      parent.appendChild(a);
      const ul = document.createElement('ul');
      ul.innerHTML = '<li id="g2-li"><a href="/reels/">Reels</a></li>';
      document.body.appendChild(ul);
    });
    await page.waitForTimeout(150);
    expect(await isShown(page.locator('#g2-reel'))).toBe(false);
    expect(await isShown(page.locator('#g2-li'))).toBe(false);
    await page.evaluate(() => {
      document.getElementById('g2-reel').removeAttribute('data-reelfree-reel');
      document.getElementById('g2-li').removeAttribute('data-reelfree-nav');
    });
    await page.waitForTimeout(150);
    expect(await isShown(page.locator('#g2-reel'))).toBe(false);
    expect(await isShown(page.locator('#g2-li'))).toBe(false);
    // Converges: no endless re-queue of our own writes.
    const n = await page.evaluate(() => new Promise((resolve) => {
      let c = 0;
      new MutationObserver((rs) => { c += rs.length; }).observe(document.documentElement,
        { subtree: true, attributes: true, attributeFilter: ['data-reelfree-reel', 'data-reelfree-nav'] });
      setTimeout(() => resolve(c), 300);
    }));
    expect(n).toBe(0);
  });

  test('R1: a Reels menu item inserted later is hidden with its container', async ({ page }) => {
    await open(page, '/?variant=following');
    await page.evaluate(() => {
      const ul = document.createElement('ul');
      ul.innerHTML = '<li id="perf-li"><a href="/reels/">Reels</a></li><li id="perf-li2"><a href="/direct/inbox/">DM</a></li>' +
        '<div role="menuitem" id="perf-mi"><a href="/reels/">Reels</a></div>';
      document.body.appendChild(ul);
    });
    await page.waitForTimeout(150);
    expect(await isShown(page.locator('#perf-li'))).toBe(false);
    expect(await isShown(page.locator('#perf-mi'))).toBe(false);
    expect(await isShown(page.locator('#perf-li2'))).toBe(true);
  });
});
