// E2E harness: serves rf-recon fixtures (or synthetic pages) as if they were https://www.instagram.com,
// injects the userscript at document-start (like the iOS Userscripts app), and records every
// network attempt so tests can assert the zero-network rule.
//
// No real network is ever used: every request is fulfilled from disk or aborted.
//
// Options (test.use({...})):
//   fixturePage      string | (pathname) => string|null   override the page served for documents
//   injectUserscript boolean (default true)
//   scriptTransform  (src: string) => string               edit the userscript text (CONFIG, fault injection)
//   config           object, e.g. { feedLimit: 3, feedMode: 'off' } — patched into CONFIG
//   preInit          string[]  page scripts run BEFORE the userscript (e.g. break sessionStorage)
//   extraRoutes      {[pathnameRegex]: file}  routes tried before the defaults (documents and SPA). An object,
//                    not an array: Playwright would read an array option as a [value, options] tuple.
//   spa              boolean   emulate Instagram's client-side router on top of static fixtures:
//                              same-origin link clicks not prevented by the userscript become
//                              history.pushState + body swap with the fixture of the target path.
import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../..');
export const SRC = process.env.REELFREE_SRC || path.join(ROOT, 'web/instagram.js');
export const IG = 'https://www.instagram.com';

export const PAGES = path.join(HERE, 'pages');
export const FIXTURES = path.join(ROOT, 'tests/fixtures');

// Default route → fixture map (tests/fixtures/README.md). tests/fixtures/routes.json, if present, wins.
const DEFAULT_ROUTES = [
  { match: '^/$', file: 'home-feed.html' },
  { match: '^/reels/', file: 'reels-feed.html' },
  { match: '^/(reel|tv)/', file: 'reel-from-dm.html' },
  // Real Instagram opens a reel shared in a DM by pushState'ing /p/<id>/ over the thread (recon, dm-thread.html).
  { match: '^/p/', file: 'reel-from-dm.html' },
  { match: '^/explore/', file: 'explore.html' },
  { match: '^/direct/t/', file: 'dm-thread.html' },
];

function routes(extra = {}) {
  let list = DEFAULT_ROUTES;
  try {
    list = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'routes.json'), 'utf8'));
  } catch { /* defaults */ }
  const own = Object.entries(extra || {}).map(([match, file]) => ({ match, file }));
  return [...own, ...list]
    .map((r) => ({ re: new RegExp(r.match, 'i'), file: fixture(r.file) }))
    .filter((r) => fs.existsSync(r.file));
}

export function fixture(name) {
  const p = path.isAbsolute(name) ? name : fs.existsSync(path.join(FIXTURES, name)) ? path.join(FIXTURES, name) : path.join(PAGES, name);
  return p;
}

// Picks the HTML file served for a pathname: per-test override, then fixtures, then the SPA shell.
export function pageFor(pathname, override, extra = {}) {
  if (override) {
    const f = typeof override === 'function' ? override(pathname) : override;
    if (f) return fixture(f);
  }
  for (const r of routes(extra)) if (r.re.test(pathname)) return r.file;
  return path.join(PAGES, 'shell.html');
}

function bodyOf(file) {
  const html = fs.readFileSync(file, 'utf8');
  const m = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  return m ? m[1] : html;
}

export function applyConfig(src, config) {
  let out = src;
  for (const [k, v] of Object.entries(config || {})) {
    const re = new RegExp(`(\\n\\s*${k}\\s*:\\s*)([^,\\n]+?)(\\s*,?\\s*//|,?\\n)`);
    if (!re.test(out)) throw new Error(`CONFIG.${k} not found in userscript`);
    out = out.replace(re, (_, a, _old, c) => a + JSON.stringify(v) + c);
  }
  return out;
}

// Test-only SPA emulation (runs in the page; innerHTML is fine here, it is not the userscript).
function spaRuntime(bodies) {
  function bodyFor(p) {
    for (const [re, html] of bodies) if (new RegExp(re, 'i').test(p)) return html;
    return '<main role="main"><p>empty</p></main>';
  }
  function render() { document.body.innerHTML = bodyFor(location.pathname); }
  window.__spa = {
    go(to) { history.pushState({}, '', to); render(); },
    replace(to) { history.replaceState({}, '', to); render(); },
    render,
  };
  window.addEventListener('popstate', render);
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    e.preventDefault();
    window.__spa.go(url.pathname + url.search);
  });
}

export const test = base.extend({
  fixturePage: [null, { option: true }],
  injectUserscript: [true, { option: true }],
  scriptTransform: [null, { option: true }],
  config: [null, { option: true }],
  preInit: [[], { option: true }],
  spa: [false, { option: true }],
  extraRoutes: [{}, { option: true }],

  // Every request attempted by the page (url, resourceType). Document loads included.
  requests: async ({}, use) => { await use([]); },

  page: async ({ page, fixturePage, injectUserscript, scriptTransform, config, preInit, spa, extraRoutes, requests }, use) => {
    for (const s of preInit) await page.addInitScript({ content: s });
    if (injectUserscript) {
      if (!fs.existsSync(SRC)) throw new Error(`userscript not found: ${SRC}`);
      let src = fs.readFileSync(SRC, 'utf8');
      if (config) src = applyConfig(src, config);
      if (scriptTransform) src = scriptTransform(src);
      await page.addInitScript({ content: src + '\n//# sourceURL=reelfree.user.js' });
    }
    if (spa) {
      const bodies = routes(extraRoutes).map((r) => [r.re.source, bodyOf(r.file)]);
      bodies.push(['.*', bodyOf(path.join(PAGES, 'shell.html')).replace(/<script[\s\S]*?<\/script>/gi, '')]);
      await page.addInitScript(spaRuntime, bodies);
    }
    const errors = [];
    page.on('pageerror', (e) => errors.push(e));
    page.__rfErrors = errors;

    await page.route('**/*', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      requests.push({ url: req.url(), type: req.resourceType() });
      if (url.origin === IG && req.resourceType() === 'document') {
        const file = pageFor(url.pathname, fixturePage, extraRoutes);
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(file) });
      }
      return route.abort('blockedbyclient');
    });
    await use(page);
  },
});

export { expect };

// Navigates to an instagram.com path and waits until the userscript has settled.
export async function open(page, p) {
  await page.goto(IG + p, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(350); // > POLL_MS (250) and > MO throttle (150)
}

export async function state(page) {
  return page.evaluate(() => ({
    path: location.pathname,
    mask: document.documentElement.getAttribute('data-reelfree'),
    mode: document.documentElement.getAttribute('data-rf-mode'),
    bodyVisible: !!document.body && getComputedStyle(document.body).display !== 'none'
      && getComputedStyle(document.body).visibility !== 'hidden',
  }));
}

export async function waitPath(page, p, timeout = 5000) {
  await expect.poll(async () => (await state(page)).path, { timeout }).toBe(p);
  await page.waitForTimeout(200);
}

// Client-side navigation, the way Instagram does it (no document load). Needs window.__spa
// (spa: true or the synthetic shell).
export async function spaNavigate(page, p) {
  await page.evaluate((to) => window.__spa.go(to), p);
  await page.waitForTimeout(350);
}

// Holds the response of a document path so a pending redirect never completes: lets a test
// inspect the forbidden page while the userscript's location.replace() is in flight.
export async function holdDocument(page, pathname) {
  await page.route(IG + pathname, async (route) => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    await new Promise((r) => setTimeout(r, 30000));
    route.abort().catch(() => {});
  });
}

// True when the element is rendered (not display:none / visibility:hidden on itself or an ancestor).
export async function isShown(locator) {
  return locator.evaluate((el) => !!(el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden');
}

// Dispatches a cancelable event in the page and returns true if the userscript prevented it.
export async function dispatchPrevented(page, kind, opts = {}) {
  return page.evaluate(({ kind, opts }) => {
    const target = (opts.selector && document.querySelector(opts.selector)) || document.body;
    let ev;
    if (kind === 'wheel') {
      ev = new WheelEvent('wheel', { deltaX: opts.dx || 0, deltaY: opts.dy ?? 400, bubbles: true, cancelable: true });
    } else if (kind === 'key') {
      ev = new KeyboardEvent('keydown', { key: opts.key || 'ArrowDown', bubbles: true, cancelable: true });
    } else if (kind === 'touch') {
      // touchstart at (100,500), then touchmove by (dx, dy). WPE WebKit has no Touch constructor and
      // rejects TouchEvent({touches}), so we build plain Events carrying a `touches` list — the
      // userscript only reads type, cancelable and touches[0].clientX/Y.
      const mk = (type, x, y) => {
        const e = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(e, 'touches', { value: [{ identifier: 1, target, clientX: x, clientY: y, pageX: x, pageY: y }] });
        return e;
      };
      target.dispatchEvent(mk('touchstart', 100, 500));
      ev = mk('touchmove', 100 + (opts.dx || 0), 500 + (opts.dy ?? -300));
    }
    target.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, { kind, opts });
}

// Requests other than the instagram.com document loads served by the harness.
export function foreignRequests(requests) {
  return requests.filter((r) => !(r.url.startsWith(IG + '/') && r.type === 'document'));
}
