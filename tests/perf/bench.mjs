#!/usr/bin/env node
// D01 perf bench (not part of `npm test`): WebKit, iPhone 11 profile, real anonymized fixtures.
//   node tests/perf/bench.mjs [--runs 5]
// Measures, for web/instagram.js in app mode (fake bridge) and without the script (baseline):
//   - hasRules  : number of :has() selectors in the injected <style> elements;
//   - idle      : timer wakeups and script ms of the userscript during 3 s of idle;
//   - scroll    : script ms + wall ms while a 600-post feed grows (infinite-scroll emulation:
//                 5 posts appended per frame; scrollStyle = time of the forced style pass);
//   - recalc    : 1000 small mutations (attribute toggle deep in the feed), each followed by a
//                 forced style read (no layout); compare before/after builds (REELFREE_SRC).
// Script ms are measured by wrapping setTimeout/setInterval/rAF/rIC/MutationObserver callbacks
// before the userscript runs (fixtures carry no scripts, so every callback is ours).
import { webkit, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = '1';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = process.env.REELFREE_SRC || path.join(ROOT, 'web/instagram.js');
const RUNS = Number((process.argv.join(' ').match(/--runs (\d+)/) || [])[1] || 5);
const IG = 'https://www.instagram.com';

const PRE = `
  window.__rfMsgs = [];
  window.webkit = { messageHandlers: { reelfree: { postMessage(m) { window.__rfMsgs.push(m); } } } };
  window.RF_CONFIG = { platform: 'ios-app', feedLimit: 1000 };
  (function () {
    const P = window.__perf = { wake: 0, ms: 0, intervals: 0 };
    const wrap = (fn) => typeof fn !== 'function' ? fn : function () {
      const t = performance.now(); P.wake++;
      try { return fn.apply(this, arguments); } finally { P.ms += performance.now() - t; }
    };
    const st = window.setTimeout, si = window.setInterval, raf = window.requestAnimationFrame,
      ric = window.requestIdleCallback, MO = window.MutationObserver;
    window.setTimeout = function (fn, ms) { return st.call(window, wrap(fn), ms); };
    window.setInterval = function (fn, ms) { P.intervals++; return si.call(window, wrap(fn), ms); };
    window.requestAnimationFrame = function (fn) { return raf.call(window, wrap(fn)); };
    if (ric) window.requestIdleCallback = function (fn, o) { return ric.call(window, wrap(fn), o); };
    window.MutationObserver = function (cb) { return new MO(wrap(cb)); };
    window.MutationObserver.prototype = MO.prototype;
  })();
`;

async function once(browser, withScript) {
  const ctx = await browser.newContext({ ...devices['iPhone 11'] });
  const page = await ctx.newPage();
  await page.addInitScript({ content: PRE });
  if (withScript) await page.addInitScript({ content: fs.readFileSync(SRC, 'utf8') });
  await page.route('**/*', (r) => {
    const req = r.request();
    if (req.url().startsWith(IG) && req.resourceType() === 'document') {
      return r.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.join(ROOT, 'tests/fixtures/home-feed.html')) });
    }
    return r.abort();
  });
  await page.goto(IG + '/?variant=following', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  const res = await page.evaluate(async () => {
    const P = window.__perf;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    const out = {};
    let txt = '';
    for (const s of document.querySelectorAll('style')) txt += s.textContent;
    out.hasRules = (txt.match(/:has\(/g) || []).length;
    out.intervals = P.intervals;

    // Idle.
    let w0 = P.wake, m0 = P.ms;
    await sleep(3000);
    out.idleWake = P.wake - w0; out.idleMs = P.ms - m0;

    // Infinite scroll: grow the feed to ~600 posts, 5 per frame.
    const main = document.querySelector('main');
    const proto = [...main.querySelectorAll('article')];
    const parent = proto[0].parentElement;
    w0 = P.wake; m0 = P.ms;
    let t0 = performance.now();
    let forced = 0;
    for (let i = 0; i < 120; i++) {
      for (let k = 0; k < 5; k++) {
        const c = proto[(i * 5 + k) % proto.length].cloneNode(true);
        c.querySelectorAll('a[href^="/p/"]').forEach((a) => a.setAttribute('href', '/p/BENCH' + i + 'x' + k + '/'));
        parent.appendChild(c);
      }
      const f = performance.now();
      void getComputedStyle(document.body).color;   // style only, no layout
      forced += performance.now() - f;
      await frame();
    }
    await sleep(400);   // let throttled/idle passes run
    out.scrollStyle = forced; out.scrollMs = P.ms - m0; out.scrollWake = P.wake - w0;
    out.articles = document.querySelectorAll('main article').length;

    // Forced style recalcs: 1000 small mutations deep in the (now big) DOM.
    const leaves = [...document.querySelectorAll('main article span')].slice(0, 1000);
    m0 = P.ms;
    t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      const el = leaves[i % leaves.length];
      el.toggleAttribute('data-bench');
      el.appendChild(document.createElement('i'));
      void getComputedStyle(document.body).color;   // style only, no layout
    }
    out.recalcWall = performance.now() - t0;
    await sleep(400);
    out.recalcMs = P.ms - m0;
    return out;
  });
  await ctx.close();
  return res;
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const browser = await webkit.launch();
const table = {};
for (const [label, withScript] of [['baseline (no script)', false], ['instagram.js app mode', true]]) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await once(browser, withScript));
  const row = {};
  for (const k of Object.keys(runs[0])) row[k] = Math.round(median(runs.map((r) => r[k])) * 10) / 10;
  table[label] = row;
}
await browser.close();
console.table(table);
