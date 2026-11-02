// E2E coverage of SPEC §2 (D1–D4): reels received in DMs.
// Every navigation style that makes sense is covered twice:
//   - full page navigation (a click loads a new document; in-memory lastThread is lost),
//   - SPA (`spa: true`, the harness emulates Instagram's client-side router).
import { test, expect, open, state, waitPath, isShown, dispatchPrevented, IG } from './harness.mjs';

const THREAD = '/direct/t/FAKETHREAD/';
const TOKEN_KEY = 'reelfree:dm-allow';
const REEL_PATH_RE = /^\/([^/]+\/)?(reel|reels|tv)\//i;

// The real capture (tests/fixtures/dm-thread.html) shares reels without an href; these tests cover
// the anchor path of D2, so the thread is the synthetic page with a[href="/reel/<id>/"].
test.use({ extraRoutes: { '^/direct/t/': 'dm-thread-legacy.html' } });

// --- local helpers -----------------------------------------------------------

// Shared reel link of the thread, located generically (fixtures will become real captures).
async function sharedReel(page) {
  const info = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('main a[href*="/reel/"], main a[href*="/reels/"]'));
    for (const a of links) {
      const m = /^\/(reels?)\/([A-Za-z0-9_-]+)\/?/.exec(new URL(a.href, location.href).pathname);
      if (m && m[2].toLowerCase() !== 'audio') {
        a.setAttribute('data-test-shared-reel', '');
        return { id: m[2], path: new URL(a.href, location.href).pathname };
      }
    }
    return null;
  });
  if (!info) throw new Error(`No shared reel link (a[href*="/reel/"] or /reels/<id>) found inside main of ${THREAD}`);
  return { ...info, link: page.locator('[data-test-shared-reel]') };
}

// Another reel link on the reel page (the "next reel" Instagram offers), id != current.
async function nextReel(page, currentId) {
  const info = await page.evaluate((cur) => {
    for (const a of document.querySelectorAll('a[href*="/reel/"], a[href*="/reels/"]')) {
      // /reel/<id>/, /reels/<id>/ or the profile form /<user>/reel/<id>/.
      const m = /^\/(?:[^/]+\/)?(reels?)\/([A-Za-z0-9_-]+)\/?$/.exec(new URL(a.href, location.href).pathname);
      if (m && m[2] !== cur && m[2].toLowerCase() !== 'audio') {
        a.setAttribute('data-test-next-reel', '');
        return { id: m[2], path: new URL(a.href, location.href).pathname };
      }
    }
    return null;
  }, currentId);
  if (!info) throw new Error('No "next reel" link (id != shared reel) found on the reel page');
  return { ...info, link: page.locator('[data-test-next-reel]') };
}

// Reads the token, retrying while a navigation destroys the execution context.
async function token(page) {
  for (let i = 0; i < 20; i++) {
    try {
      return await page.evaluate((k) => sessionStorage.getItem(k), TOKEN_KEY);
    } catch {
      await page.waitForTimeout(100);
    }
  }
  throw new Error('could not read sessionStorage');
}

async function setToken(page, value) {
  await page.evaluate(([k, v]) => sessionStorage.setItem(k, v), [TOKEN_KEY, value]);
}

async function safeState(page) {
  try { return await state(page); } catch { return { path: '(navigating)' }; }
}

// Waits until the page has left any reel route, then lets redirects (/ → /?variant=following) settle.
async function waitBlocked(page) {
  await expect.poll(async () => {
    const p = (await safeState(page)).path;
    return p !== '(navigating)' && !REEL_PATH_RE.test(p);
  }, { timeout: 5000, message: 'expected to be redirected away from the reel route' }).toBe(true);
  await page.waitForTimeout(700);
  await page.waitForLoadState('domcontentloaded');
  const s = await safeState(page);
  expect(s.path, 'still/again on a reel route after settling').not.toMatch(REEL_PATH_RE);
  return s;
}

async function waitSettled(page, p) {
  await waitPath(page, p);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(350);
}

async function expectAdmitted(page, reelPath) {
  await waitSettled(page, reelPath);
  await expect.poll(async () => (await state(page)).mode).toBe('dm-reel');
  expect(await state(page)).toMatchObject({ path: reelPath, mask: 'ok', mode: 'dm-reel', bodyVisible: true });
  expect(await token(page), 'token must be consumed on arrival').toBeNull();
}

function noErrors(page) {
  expect(page.__rfErrors.map(String)).toEqual([]);
}

// Opens the thread and clicks the shared reel; returns the reel info once admitted.
async function admitViaClick(page) {
  await open(page, THREAD);
  const r = await sharedReel(page);
  await r.link.click();
  await expectAdmitted(page, r.path);
  return r;
}

// Clicks a link without letting it navigate (prevented at the anchor, after the userscript's
// window-capture click handler ran): only the token side-effect remains.
async function clickWithoutNavigating(page, selector) {
  await page.evaluate((sel) => {
    const a = document.querySelector(sel);
    a.addEventListener('click', (e) => e.preventDefault(), { once: true });
    a.click();
  }, selector);
}

// --- D1 ----------------------------------------------------------------------

test('D1 — shared reel stays visible in the DM thread, Reels tab still hidden', async ({ page }) => {
  await open(page, THREAD);
  expect(await state(page)).toMatchObject({ path: THREAD, mask: 'ok', mode: 'dm', bodyVisible: true });
  const r = await sharedReel(page);
  expect(await isShown(r.link), 'shared reel link masked').toBe(true);
  const video = r.link.locator('video, [aria-label="Video player"]').first();
  expect(await video.count(), 'no video player inside the shared reel').toBeGreaterThan(0);
  expect(await isShown(video), 'shared reel video masked').toBe(true);
  await expect(page.locator('a[href="/reels/"]')).toBeHidden();
  noErrors(page);
});

// --- D2 ----------------------------------------------------------------------

test.describe('D2 — click from the thread (full navigation)', () => {
  test('D2 — click on the shared reel is admitted and the token is consumed', async ({ page }) => {
    await admitViaClick(page);
    noErrors(page);
  });

  test('D2 — direct goto /reel/<id>/ without token is redirected', async ({ page }) => {
    await open(page, THREAD);
    const r = await sharedReel(page);
    await page.goto(IG + r.path, { waitUntil: 'domcontentloaded' });
    await waitBlocked(page);
    expect(await token(page)).toBeNull();
    noErrors(page);
  });

  test('D2 — expired token (11 s old) is refused and removed', async ({ page }) => {
    await open(page, THREAD);
    const r = await sharedReel(page);
    await page.evaluate(([k, id]) => sessionStorage.setItem(k, id + ':' + (Date.now() - 11000)), [TOKEN_KEY, r.id]);
    await page.goto(IG + r.path, { waitUntil: 'domcontentloaded' });
    await waitBlocked(page);
    expect(await token(page)).toBeNull();
    noErrors(page);
  });

  test('D2 — token for another id is refused and removed', async ({ page }) => {
    await open(page, THREAD);
    const r = await sharedReel(page);
    await page.evaluate((k) => sessionStorage.setItem(k, 'SOMEOTHERID9:' + Date.now()), TOKEN_KEY);
    await page.goto(IG + r.path, { waitUntil: 'domcontentloaded' });
    await waitBlocked(page);
    expect(await token(page)).toBeNull();
    noErrors(page);
  });

  test('D2 — token with a future timestamp is refused and removed', async ({ page }) => {
    await open(page, THREAD);
    const r = await sharedReel(page);
    await page.evaluate(([k, id]) => sessionStorage.setItem(k, id + ':' + (Date.now() + 60000)), [TOKEN_KEY, r.id]);
    await page.goto(IG + r.path, { waitUntil: 'domcontentloaded' });
    await waitBlocked(page);
    expect(await token(page)).toBeNull();
    noErrors(page);
  });

  test('D2 — token is one-shot: reloading the admitted reel is refused', async ({ page }) => {
    await admitViaClick(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitBlocked(page);
    expect(await token(page)).toBeNull();
    noErrors(page);
  });
});

test.describe('D2 — SPA', () => {
  test.use({ spa: true });

  test('D2 — SPA click on the shared reel is admitted and the token is consumed', async ({ page }) => {
    await admitViaClick(page);
    noErrors(page);
  });

  test('D2 — SPA token reuse: going to the same reel again is refused', async ({ page }) => {
    const r = await admitViaClick(page);
    await page.goto(IG + r.path, { waitUntil: 'domcontentloaded' });
    await waitBlocked(page);
    expect(await token(page)).toBeNull();
    noErrors(page);
  });

  test('D2 fallback — pointerdown in the thread then SPA navigation (no <a> click) is admitted', async ({ page }) => {
    await open(page, THREAD);
    const r = await sharedReel(page);
    await page.evaluate((to) => {
      // The tap must land on the shared media (A01: the fallback is bound to the tapped media id).
      const cell = document.querySelector('[data-test-shared-reel]').closest('[role="gridcell"]');
      cell.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch' }));
      window.__spa.go(to);
    }, r.path);
    await expectAdmitted(page, r.path);
    noErrors(page);
  });

  test('D2 fallback — same SPA navigation without a prior tap is refused', async ({ page }) => {
    await open(page, THREAD);
    const r = await sharedReel(page);
    await page.evaluate((to) => window.__spa.go(to), r.path);
    const s = await waitBlocked(page);
    expect(s.path, 'refused reel should lead back to the origin conversation').toBe(THREAD);
    expect(await token(page)).toBeNull();
    noErrors(page);
  });

  test.describe('short TTL', () => {
    test.use({ config: { dmReelTtlMs: 300 } });

    test('D2 — token older than dmReelTtlMs (300 ms) is refused and removed', async ({ page }) => {
      await open(page, THREAD);
      const r = await sharedReel(page);
      await clickWithoutNavigating(page, '[data-test-shared-reel]');
      expect(await token(page), 'click in /direct/ should write the token').toMatch(new RegExp(`^${r.id}:\\d+$`));
      await page.waitForTimeout(600);
      await page.evaluate((to) => window.__spa.go(to), r.path);
      const s = await waitBlocked(page);
      expect(s.path).toBe(THREAD);
      expect(await token(page)).toBeNull();
      noErrors(page);
    });
  });
});

// --- D3 ----------------------------------------------------------------------

test.describe('D3 — scroll lock', () => {
  test('D3 — vertical wheel/touch/keys are blocked on an admitted reel, horizontal ones are not', async ({ page }) => {
    await admitViaClick(page);
    expect(await dispatchPrevented(page, 'wheel', { dy: 400 }), 'vertical wheel').toBe(true);
    expect(await dispatchPrevented(page, 'wheel', { dy: -400 }), 'vertical wheel up').toBe(true);
    expect(await dispatchPrevented(page, 'touch', { dy: -300 }), 'vertical touchmove').toBe(true);
    for (const key of ['ArrowDown', 'PageDown', ' ']) {
      expect(await dispatchPrevented(page, 'key', { key }), `keydown ${JSON.stringify(key)}`).toBe(true);
    }
    expect(await dispatchPrevented(page, 'wheel', { dx: 400, dy: 0 }), 'horizontal wheel').toBe(false);
    expect(await dispatchPrevented(page, 'touch', { dx: 300, dy: 0 }), 'horizontal touchmove').toBe(false);
    await page.evaluate(() => {
      const input = document.createElement('textarea');
      input.id = 'test-editable';
      document.body.appendChild(input);
    });
    expect(await dispatchPrevented(page, 'key', { key: 'ArrowDown', selector: '#test-editable' }), 'keydown in editable').toBe(false);
    expect(await dispatchPrevented(page, 'key', { key: ' ', selector: '#test-editable' }), 'space in editable').toBe(false);
    noErrors(page);
  });

  test('D3 — vertical wheel is not blocked on the home feed nor on the thread', async ({ page }) => {
    await open(page, '/?variant=following');
    await waitSettled(page, '/');
    expect((await state(page)).mode).toBe('feed');
    expect(await dispatchPrevented(page, 'wheel', { dy: 400 }), 'wheel on feed').toBe(false);
    await open(page, THREAD);
    expect((await state(page)).mode).toBe('dm');
    expect(await dispatchPrevented(page, 'wheel', { dy: 400 }), 'wheel on thread').toBe(false);
    expect(await dispatchPrevented(page, 'touch', { dy: -300 }), 'touchmove on thread').toBe(false);
    noErrors(page);
  });
});

test.describe('D3 — no chaining (SPA)', () => {
  test.use({ spa: true });

  test('D3 — next reel is hidden, unclickable, and SPA navigation to it returns to the thread', async ({ page }) => {
    const r = await admitViaClick(page);
    const n = await nextReel(page, r.id);
    expect(await isShown(n.link), '"next reel" link should be hidden').toBe(false);
    await page.evaluate(() => document.querySelector('[data-test-next-reel]').click());
    await page.waitForTimeout(400);
    expect((await state(page)).path, 'click on next reel left the admitted reel').toBe(r.path);
    expect(await token(page)).toBeNull();
    await page.evaluate((to) => window.__spa.go(to), n.path);
    const s = await waitBlocked(page);
    expect(s.path, 'chaining must lead back to the origin conversation').toBe(THREAD);
    expect(await token(page)).toBeNull();
    noErrors(page);
  });

  test('D3 overlay — video dialog over the thread: reel links inert, no token, vertical wheel blocked', async ({ page }) => {
    await open(page, THREAD);
    await page.evaluate(() => {
      const dlg = document.createElement('div');
      dlg.setAttribute('role', 'dialog');
      const a = document.createElement('a');
      a.href = '/reel/OTHER123/';
      a.id = 'test-overlay-link';
      a.textContent = 'next';
      dlg.appendChild(document.createElement('video'));
      dlg.appendChild(a);
      document.body.appendChild(dlg);
    });
    await page.waitForTimeout(400);
    await page.evaluate(() => document.getElementById('test-overlay-link').click());
    await page.waitForTimeout(400);
    expect((await state(page)).path).toBe(THREAD);
    expect(await token(page), 'overlay click must not write a token').toBeNull();
    expect(await dispatchPrevented(page, 'wheel', { dy: 400 }), 'vertical wheel under overlay').toBe(true);
    noErrors(page);
  });
});

test.describe('D3 — no chaining (full navigation)', () => {
  test('D3 — next reel hidden/unclickable; history navigation to it never shows a reel', async ({ page }) => {
    const r = await admitViaClick(page);
    const n = await nextReel(page, r.id);
    expect(await isShown(n.link), '"next reel" link should be hidden').toBe(false);
    await n.link.dispatchEvent('click');
    await page.waitForTimeout(400);
    expect((await state(page)).path, 'click on next reel left the admitted reel').toBe(r.path);
    // lastThread was lost with the document load, so the userscript cannot know the origin
    // conversation: observed target is "/" (then /?variant=following), not the thread.
    await page.evaluate((to) => history.pushState({}, '', to), n.path);
    const s = await waitBlocked(page);
    expect(s.path).not.toMatch(REEL_PATH_RE);
    expect(await token(page)).toBeNull();
    noErrors(page);
  });
});

// --- D4 ----------------------------------------------------------------------

test.describe('D4 — back button', () => {
  test('D4 — absent on thread and feed; on the reel (full nav) it goes to /direct/inbox/', async ({ page }) => {
    await open(page, '/?variant=following');
    await waitSettled(page, '/');
    const back = page.locator('#reelfree-back');
    expect((await back.count()) === 0 || !(await isShown(back)), 'back button on feed').toBe(true);
    await open(page, THREAD);
    expect((await back.count()) === 0 || !(await isShown(back)), 'back button on thread').toBe(true);
    const r = await sharedReel(page);
    await r.link.click();
    await expectAdmitted(page, r.path);
    await expect(back).toBeVisible();
    await expect(back).toHaveText('← Retour à la conversation');
    await back.click();
    // Full navigation lost lastThread: the script falls back to the inbox.
    await waitSettled(page, '/direct/inbox/');
    noErrors(page);
  });

  test.describe('SPA', () => {
    test.use({ spa: true });

    test('D4 — SPA: back button returns to the origin conversation', async ({ page }) => {
      await admitViaClick(page);
      const back = page.locator('#reelfree-back');
      await expect(back).toBeVisible();
      await back.click();
      await waitSettled(page, THREAD);
      expect(await state(page)).toMatchObject({ mode: 'dm', mask: 'ok' });
      expect((await back.count()) === 0 || !(await isShown(back))).toBe(true);
      noErrors(page);
    });
  });
});
