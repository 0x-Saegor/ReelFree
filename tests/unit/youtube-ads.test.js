// D05: web/youtube-ads.js (page world) — pure prune function and static guarantees of the source.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ads = require('../../web/youtube-ads.js');

const SRC = fs.readFileSync(path.join(__dirname, '../../web/youtube-ads.js'), 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');   // comments stripped

const withAds = () => ({ playabilityStatus: { status: 'OK' }, videoDetails: { videoId: 'x' },
  adPlacements: [1], playerAds: [2], adSlots: [3] });

test('prune removes the three ad keys and keeps everything else', () => {
  const o = withAds();
  assert.strictEqual(ads.prune(o), true);
  assert.deepStrictEqual(o, { playabilityStatus: { status: 'OK' }, videoDetails: { videoId: 'x' } });
});

test('prune handles playerResponse nested in /next-like payloads and arrays', () => {
  const o = { playerResponse: withAds(), response: { contents: 1 } };
  assert.strictEqual(ads.prune(o), true);
  assert.deepStrictEqual(Object.keys(o.playerResponse).sort(), ['playabilityStatus', 'videoDetails']);
  const arr = [{ playerResponse: withAds() }, { response: {} }];
  assert.strictEqual(ads.prune(arr), true);
  assert.ok(!('adSlots' in arr[0].playerResponse));
});

test('prune is shallow: ad-looking keys deeper in the data are left alone', () => {
  const o = { videoDetails: { adSlots: 'title text' }, contents: { adPlacements: 1 } };
  assert.strictEqual(ads.prune(o), false);
  assert.deepStrictEqual(o, { videoDetails: { adSlots: 'title text' }, contents: { adPlacements: 1 } });
});

test('prune ignores non-objects and frozen objects without throwing', () => {
  for (const v of [null, undefined, 1, 'adSlots', true]) assert.strictEqual(ads.prune(v), false);
  const f = Object.freeze(withAds());
  assert.doesNotThrow(() => ads.prune(f));
});

test('hostAllowed: youtube.com and subdomains only', () => {
  for (const h of ['youtube.com', 'm.youtube.com', 'WWW.YOUTUBE.COM']) assert.ok(ads.hostAllowed(h), h);
  for (const h of ['evilyoutube.com', 'youtube.com.evil.example', 'www.instagram.com', 'accounts.google.com', '', null]) {
    assert.ok(!ads.hostAllowed(h), String(h));
  }
});

test('static: no bridge, no storage, no cookies, no dynamic code, no HTML sinks, no own network', () => {
  const banned = [/webkit/, /messageHandlers/, /localStorage|sessionStorage|indexedDB/, /document\.cookie/,
    /\beval\s*\(/, /new\s+Function/, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/,
    /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /importScripts|import\s*\(/, /postMessage/, /setInterval/];
  for (const re of banned) assert.ok(!re.test(CODE), `forbidden: ${re}`);
  // fetch is only called as origFetch.apply (the page's own request, passed through).
  assert.deepStrictEqual(CODE.match(/fetch\s*\(/g), null);
});
