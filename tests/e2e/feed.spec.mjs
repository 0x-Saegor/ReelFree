// Home feed E2E (T15): R4 (reels in feed), S1 (cap + "Tu es à jour"), S2 (suggested, caught-up marker),
// S3 (feedMode 'off'), R1 (Reels tab) — on both feed captures (tests/fixtures/home-feed.html and
// feed-following.html).
//
// Articles are classified by STRUCTURE (links, labels), never by index or data-fixture-kind, so the
// tests keep working when rf-recon replaces the captures; a missing kind fails with a clear message.
import { test, expect, open } from './harness.mjs';

const FEEDS = [
  { name: 'home (Pour vous)', fixturePage: null },          // default route: home-feed.html
  { name: 'following (Abonnements)', fixturePage: 'feed-following.html' },
];

const SETTLE_MS = 450;   // > MO throttle (150 ms) + margin

// Page-side helpers, installed before any page script (test code, not the userscript).
function installHelpers() {
  const isReelHref = (h) => /^\/reel\/[^/]/.test(h) || (/^\/reels\/[^/]+/.test(h) && !/^\/reels\/audio\//.test(h));
  const hrefs = (el) => Array.from(el.querySelectorAll('a[href]'), (a) => a.getAttribute('href'));
  const leafLabel = (el, labels) => Array.from(el.querySelectorAll('[role="button"], button'))
    .some((b) => b.children.length === 0 && labels.includes((b.textContent || '').trim()));

  function kindOf(a) {
    const h = hrefs(a);
    if (h.some(isReelHref)) return 'reel';
    if (h.some((x) => /^\/ads\//.test(x) || /instagram\.com\/ads\//.test(x))) return 'ad';
    if (/Suggestions pour vous|Suggested for you|Suggested posts/.test(a.textContent || '')
      || leafLabel(a, ['Suivre', 'Follow'])) return 'suggested';
    if (a.querySelector('video')) return 'video';
    if (h.some((x) => /^\/p\/[A-Za-z0-9_-]+\/$/.test(x))) return 'photo';
    return 'other';
  }
  const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const articles = () => Array.from(document.querySelectorAll('main article'));

  let template = null;
  let n = 0;
  function strip(el) {
    for (const e of [el, ...el.querySelectorAll('*')]) {
      for (const at of Array.from(e.attributes)) if (at.name.startsWith('data-reelfree')) e.removeAttribute(at.name);
    }
  }
  // A fresh plain-photo article (new shortcode), like Instagram's pagination would mount.
  function makePhoto(opts = {}) {
    if (!template) {
      const src = articles().find((a) => kindOf(a) === 'photo');
      if (!src) throw new Error('fixture has no plain photo article to clone');
      template = src.cloneNode(true);
      strip(template);
    }
    const c = template.cloneNode(true);
    const id = 'RFCLONE' + (++n) + (opts.tag || '');
    for (const a of c.querySelectorAll('a[href^="/p/"]')) {
      a.setAttribute('href', a.getAttribute('href').replace(/^\/p\/[^/]+\//, '/p/' + id + '/'));
    }
    if (opts.audio) {
      const link = document.createElement('a');
      link.setAttribute('href', '/reels/audio/123/');
      link.textContent = 'Original audio';
      (c.firstElementChild || c).appendChild(link);
    }
    c.setAttribute('data-test-id', id);
    return c;
  }
  // Appends nodes at the end of the container that holds the feed articles.
  function append(nodes) {
    const list = articles();
    if (!list.length) throw new Error('no main article in fixture');
    const parent = list[list.length - 1].parentElement;
    for (const node of nodes) parent.appendChild(node);
  }
  window.__rfTest = {
    kindOf, shown, articles,
    summary: () => articles().map((a) => ({
      kind: kindOf(a), shown: shown(a), id: a.getAttribute('data-test-id'),
      after: getComputedStyle(a, '::after').content,
      videos: Array.from(a.querySelectorAll('video')).map(shown),
    })),
    appendPhotos(count, opts) {
      const out = [];
      for (let i = 0; i < count; i++) out.push(makePhoto(opts));
      append(out);
      return out.map((c) => c.getAttribute('data-test-id'));
    },
    append,
    makePhoto,
  };
}

test.beforeEach(async ({ page }) => { await page.addInitScript(installHelpers); });
test.afterEach(async ({ page }) => { expect(page.__rfErrors.map(String)).toEqual([]); });

const summary = (page) => page.evaluate(() => window.__rfTest.summary());
const appendPhotos = (page, count, opts = {}) =>
  page.evaluate(({ count, opts }) => window.__rfTest.appendPhotos(count, opts), { count, opts });
const loaderShown = (page) => page.evaluate(() => {
  const l = document.querySelector('main [data-visualcompletion="loading-state"][role="progressbar"]');
  if (!l) throw new Error('fixture has no pagination loader [data-visualcompletion="loading-state"][role="progressbar"]');
  return window.__rfTest.shown(l);
});
const settle = (page) => page.waitForTimeout(SETTLE_MS);

function requireKind(list, kind, feed, min = 1) {
  const n = list.filter((a) => a.kind === kind).length;
  if (n < min) {
    throw new Error(`fixture "${feed}" must contain at least ${min} "${kind}" article(s), found ${n} ` +
      `(kinds: ${list.map((a) => a.kind).join(', ')})`);
  }
}

const isCapMarker = (after) => typeof after === 'string' && after.includes('Tu es à jour');
// The "Tu es à jour" block may be rendered on the last allowed post (article::after) or at the end
// of the feed (main::after): accept either, but it must be shown exactly once, after the last
// visible post. Returns where it was found.
async function capMarker(page, list) {
  const main = await page.evaluate(() => getComputedStyle(document.querySelector('main'), '::after').content);
  const shownPosts = list.filter((a) => a.shown);
  const onPosts = shownPosts.filter((a) => isCapMarker(a.after));
  return {
    count: onPosts.length + (isCapMarker(main) ? 1 : 0),
    onLastPost: onPosts.length === 1 && onPosts[0] === shownPosts[shownPosts.length - 1],
    onMain: isCapMarker(main),
  };
}

for (const feed of FEEDS) {
  test.describe(`feed: ${feed.name}`, () => {
    test.use({ fixturePage: feed.fixturePage });

    test('R4 — reel articles hidden, their video not shown, plain photos visible', async ({ page }) => {
      await open(page, '/');
      const list = await summary(page);
      requireKind(list, 'reel', feed.name);
      requireKind(list, 'photo', feed.name);
      for (const a of list.filter((x) => x.kind === 'reel')) {
        expect(a.shown, 'reel article must be hidden').toBe(false);
        expect(a.videos.length, 'reel article should carry a <video>').toBeGreaterThan(0);
        expect(a.videos.every((v) => v === false), 'reel <video> must not be shown').toBe(true);
      }
      for (const a of list.filter((x) => x.kind === 'photo')) expect(a.shown, 'plain photo must stay visible').toBe(true);
      // No video anywhere in the feed is visible inside a reel article.
      const visibleReelVideos = await page.evaluate(() => Array.from(document.querySelectorAll('main article video'))
        .filter((v) => window.__rfTest.kindOf(v.closest('article')) === 'reel' && window.__rfTest.shown(v)).length);
      expect(visibleReelVideos).toBe(0);
    });

    test('R4 non-regression — photo post with only a /reels/audio/ music link stays visible', async ({ page }) => {
      await open(page, '/');
      requireKind(await summary(page), 'photo', feed.name);
      const [id] = await appendPhotos(page, 1, { audio: true, tag: 'AUDIO' });
      await settle(page);
      const a = (await summary(page)).find((x) => x.id === id);
      expect(a, 'injected article').toBeTruthy();
      expect(a.kind).toBe('photo');
      expect(a.shown, 'photo post with a music link (/reels/audio/123/) must stay visible').toBe(true);
    });

    test('S1 — cap at 15: loader visible before, exactly 15 posts shown, "Tu es à jour" on the 15th', async ({ page }) => {
      const LIMIT = 15;
      await open(page, '/');
      const before = await summary(page);
      requireKind(before, 'photo', feed.name);
      const k = before.filter((a) => a.kind === 'photo' && a.shown).length;
      expect(k, 'raw fixture already has >= 15 visible photos').toBeLessThan(LIMIT);

      // Below the cap: everything counted is visible, loader visible, not capped.
      await appendPhotos(page, LIMIT - 1 - k);
      await settle(page);
      let list = await summary(page);
      expect(list.filter((a) => a.shown).length).toBe(LIMIT - 1);
      expect(await loaderShown(page), 'loader visible before the cap').toBe(true);
      expect(await page.evaluate(() => document.documentElement.hasAttribute('data-rf-capped'))).toBe(false);
      expect((await capMarker(page, list)).count, 'no "Tu es à jour" before the cap').toBe(0);

      // Infinite loading: more posts than the cap.
      await appendPhotos(page, 8);
      await settle(page);
      list = await summary(page);
      const shown = list.filter((a) => a.shown);
      expect(shown.length, 'exactly 15 posts visible').toBe(LIMIT);
      expect(shown.every((a) => a.kind === 'photo')).toBe(true);
      const lastIdx = list.indexOf(shown[shown.length - 1]);
      expect(list.slice(lastIdx + 1).every((a) => !a.shown), 'posts after the 15th are hidden').toBe(true);
      expect(list.filter((a) => a.kind === 'photo' && !a.shown).length).toBe(list.filter((a) => a.kind === 'photo').length - LIMIT);
      const m = await capMarker(page, list);
      expect(m.count, '"Tu es à jour" shown exactly once').toBe(1);
      expect(m.onLastPost || m.onMain, '"Tu es à jour" after the 15th post').toBe(true);
      expect(await loaderShown(page), 'loader hidden once capped').toBe(false);
    });

    test('S1 virtualization — after capping, unmounted posts + new pages stay hidden', async ({ page }) => {
      await open(page, '/');
      requireKind(await summary(page), 'photo', feed.name);
      await appendPhotos(page, 20);
      await settle(page);
      expect((await summary(page)).filter((a) => a.shown).length).toBe(15);

      // Instagram unmounts the first posts while scrolling, then mounts the next page.
      const removed = await page.evaluate(() => {
        const vis = window.__rfTest.articles().filter(window.__rfTest.shown).slice(0, 5);
        vis.forEach((a) => a.remove());
        return vis.length;
      });
      expect(removed).toBe(5);
      await settle(page);
      const fresh = await appendPhotos(page, 5, { tag: 'LATE' });
      await settle(page);
      const list = await summary(page);
      for (const id of fresh) {
        expect(list.find((a) => a.id === id).shown, `new post ${id} after cap must be hidden`).toBe(false);
      }
      expect(list.filter((a) => a.shown).length, 'cap holds after unmount').toBe(10);
      expect(await loaderShown(page)).toBe(false);
    });

    test('S2 — content after Instagram\'s "caught up" marker is hidden', async ({ page }) => {
      await open(page, '/');
      requireKind(await summary(page), 'photo', feed.name);
      const id = await page.evaluate(() => {
        const marker = document.createElement('div');
        const img = document.createElement('img');
        img.setAttribute('src', '/static/illo-confirm-refresh-light.png');
        marker.appendChild(img);
        const after = window.__rfTest.makePhoto({ tag: 'AFTERMARK' });
        window.__rfTest.append([marker, after]);
        return after.getAttribute('data-test-id');
      });
      await settle(page);
      const list = await summary(page);
      expect(list.find((a) => a.id === id).shown, 'post after the caught-up marker must be hidden').toBe(false);
      for (const a of list.filter((x) => x.kind === 'photo' && x.id !== id)) expect(a.shown).toBe(true);
    });

    test('R1 — Reels tab hidden, other nav links visible', async ({ page }) => {
      await open(page, '/');
      const r = await page.evaluate(() => {
        const any = (sel) => Array.from(document.querySelectorAll(sel));
        return {
          reels: any('a[href="/reels/"]').map(window.__rfTest.shown),
          home: any('a[href="/"]').some(window.__rfTest.shown),
          inbox: any('a[href="/direct/inbox/"]').some(window.__rfTest.shown),
        };
      });
      expect(r.reels.length, 'fixture must contain the Reels tab a[href="/reels/"]').toBeGreaterThan(0);
      expect(r.reels.every((v) => v === false), 'Reels tab hidden').toBe(true);
      expect(r.home, 'home link visible').toBe(true);
      expect(r.inbox, 'DM link visible').toBe(true);
    });
  });
}

for (const feed of FEEDS) {
  test.describe(`feed off: ${feed.name}`, () => {
    test.use({ fixturePage: feed.fixturePage, config: { feedMode: 'off' } });

    test('S3 — feedMode off hides every post and the loader, keeps nav and stories', async ({ page }) => {
      await open(page, '/');
      const list = await summary(page);
      expect(list.length, 'fixture must contain main article').toBeGreaterThan(0);
      expect(list.filter((a) => a.shown).map((a) => a.kind), 'no feed article visible').toEqual([]);
      expect(await loaderShown(page), 'loader hidden').toBe(false);
      const r = await page.evaluate(() => {
        const T = window.__rfTest;
        // Stories tray: a list in main, outside any article, whose items are buttons (avatars).
        const tray = Array.from(document.querySelectorAll('main ul'))
          .find((ul) => !ul.closest('article') && ul.querySelector('li [role="button"]'));
        return {
          inbox: Array.from(document.querySelectorAll('a[href="/direct/inbox/"]')).some(T.shown),
          tray: tray ? T.shown(tray) : null,
          after: getComputedStyle(document.querySelector('main'), '::after').content,
        };
      });
      expect(r.inbox, 'DM link visible').toBe(true);
      expect(r.tray, 'fixture must contain a stories tray (main ul > li [role=button])').not.toBeNull();
      expect(r.tray, 'stories tray visible').toBe(true);
      expect(r.after).toContain('Fil masqué');
    });
  });
}

test.describe('feed: suggested posts', () => {
  test('S2 — suggested article ("Suggestions pour vous" / "Suivre") is hidden', async ({ page }) => {
    await open(page, '/');
    const list = await summary(page);
    requireKind(list, 'suggested', 'home (Pour vous)');
    for (const a of list.filter((x) => x.kind === 'suggested')) expect(a.shown, 'suggested article hidden').toBe(false);
    for (const a of list.filter((x) => x.kind === 'photo')) expect(a.shown).toBe(true);
  });
});

test.describe('feed: small cap', () => {
  test.use({ fixturePage: 'feed-following.html', config: { feedLimit: 2 } });

  test('S1 — feedLimit 2 on the raw capture: 2 posts, marker on the 2nd, loader hidden', async ({ page }) => {
    await open(page, '/');
    const list = await summary(page);
    requireKind(list, 'photo', 'following (Abonnements)', 2);
    const photos = list.filter((a) => a.kind === 'photo');
    const shown = list.filter((a) => a.shown);
    expect(shown.length).toBe(2);
    expect(photos.slice(0, 2).every((a) => a.shown)).toBe(true);
    expect(photos.slice(2).every((a) => !a.shown)).toBe(true);
    const m = await capMarker(page, list);
    expect(m.count, '"Tu es à jour" shown exactly once').toBe(1);
    expect(m.onLastPost || m.onMain, '"Tu es à jour" after the 2nd post').toBe(true);
    expect(list.slice(list.indexOf(shown[1]) + 1).every((a) => !a.shown)).toBe(true);
    expect(await loaderShown(page), 'loader hidden once capped').toBe(false);
  });
});
