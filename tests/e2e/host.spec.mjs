// Avenant 1 (docs/SPEC-iOS.md): injected on a bound domain that is not its own host, each script is a
// no-op — no mask, no style, no listeners blocking anything, no bridge object, no message.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>t</title></head>
<body><main><a id="l1" href="/reels/">reels</a><a id="l2" href="/shorts/dQw4w9WgXcQ">short</a><p>ok</p></main></body></html>`;
const BRIDGE = `
  window.__rfMsgs = [];
  window.webkit = { messageHandlers: { reelfree: { postMessage(m) { window.__rfMsgs.push(m); } } } };
  window.RF_CONFIG = { platform: 'ios-app' };
`;

const CASES = [
  // [script, foreign hosts (all App-Bound or look-alikes), own host]
  ['instagram.js', ['https://accounts.google.com', 'https://scontent.cdninstagram.com', 'https://m.youtube.com', 'https://evilinstagram.com'], 'https://www.instagram.com'],
  ['youtube.js', ['https://accounts.google.com', 'https://i.ytimg.com', 'https://www.instagram.com', 'https://evilyoutube.com'], 'https://m.youtube.com'],
];

async function load(page, script, origin, p) {
  await page.addInitScript({ content: BRIDGE });
  await page.addInitScript({ content: fs.readFileSync(path.join(ROOT, 'web', script), 'utf8') });
  await page.route('**/*', (route) => (route.request().resourceType() === 'document'
    ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE })
    : route.abort('blockedbyclient')));
  await page.goto(origin + p, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  return page.evaluate(() => ({
    path: location.pathname,
    mask: document.documentElement.getAttribute('data-reelfree'),
    styles: document.querySelectorAll('style').length,
    bridge: typeof window.reelfree,
    msgs: window.__rfMsgs.length,
    bodyVisible: getComputedStyle(document.body).display !== 'none',
  }));
}

for (const [script, foreign, own] of CASES) {
  for (const origin of foreign) {
    test(`${script} is a no-op on ${origin}`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      // A path that the script would redirect on its own host.
      const s = await load(page, script, origin, script === 'instagram.js' ? '/reels/' : '/shorts/dQw4w9WgXcQ');
      expect(s).toEqual({ path: s.path, mask: null, styles: 0, bridge: 'undefined', msgs: 0, bodyVisible: true });
      expect(s.path).toBe(script === 'instagram.js' ? '/reels/' : '/shorts/dQw4w9WgXcQ');
      const prevented = await page.evaluate(() => {
        const ev = new WheelEvent('wheel', { deltaY: 400, bubbles: true, cancelable: true });
        document.body.dispatchEvent(ev);
        return ev.defaultPrevented;
      });
      expect(prevented).toBe(false);
      expect(errors).toEqual([]);
    });
  }

  test(`${script} is active on its own host ${own} (control)`, async ({ page }) => {
    const s = await load(page, script, own, '/');
    expect(s.mask).toBe('ok');
    expect(s.bridge).toBe('object');
    expect(s.msgs).toBeGreaterThan(0);
  });
}
