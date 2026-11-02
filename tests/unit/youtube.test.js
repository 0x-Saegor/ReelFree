'use strict';
// decideYT(path, search, ctx) and mergeConfig() of web/youtube.js (B03).

const test = require('node:test');
const assert = require('node:assert/strict');
const { decideYT, mergeConfig } = require('../../web/youtube.js');

const VID = 'dQw4w9WgXcQ';   // 11 chars, the YouTube video id format
const CH = 'UC' + 'a'.repeat(22);

// [path, ctx, action, to?, mode?]
const CASES = [
  ['/', {}, 'allow', null, 'home'],
  ['/', { config: { hideHomeFeed: true } }, 'allow', null, 'home-off'],
  [`/watch?v=${VID}`, {}, 'allow', null, 'watch'],
  ['/results?search_query=x', {}, 'allow', null, 'other'],
  ['/@someone', {}, 'allow', null, 'other'],
  [`/shorts/${VID}`, {}, 'redirect', `/watch?v=${VID}`],
  [`/shorts/${VID}/`, {}, 'redirect', `/watch?v=${VID}`],
  [`/SHORTS/${VID}`, {}, 'redirect', `/watch?v=${VID}`],
  [`/shorts/${VID}?feature=share`, {}, 'redirect', `/watch?v=${VID}`],
  [`/shorts;x/${VID}`, {}, 'redirect', `/watch?v=${VID}`],
  ['/shorts/', {}, 'redirect', '/'],
  ['/shorts/tooShort', {}, 'redirect', '/'],
  ['/shorts/abc%26v%3Dx12', {}, 'redirect', '/'],
  ['/feed/shorts', {}, 'redirect', '/'],
  ['/@someone/shorts', {}, 'redirect', '/@someone'],
  [`/channel/${CH}/shorts`, {}, 'redirect', `/channel/${CH}`],
  ['/c/Name_1/shorts', {}, 'redirect', '/c/Name_1'],
  ['/user/Name.1/shorts', {}, 'redirect', '/user/Name.1'],
  ['/user/..%2F..%2Fx/shorts', {}, 'hide'],
  ['/@a%20b/shorts', {}, 'redirect', '/'],
  ['/%2F%2Fevil.example/shorts', {}, 'hide'],
  ['/shorts%2F' + VID, {}, 'hide'],
  ['/x/../shorts/' + VID, {}, 'hide'],
  ['/%E0%A4%A', {}, 'hide'],
];

for (const [p, ctx, action, to, mode] of CASES) {
  test(`decideYT ${p} ${JSON.stringify(ctx)} -> ${action} ${to || ''}`, () => {
    const r = decideYT(p, '', ctx);
    assert.equal(r.action, action);
    if (to !== undefined) assert.equal(r.to, to);
    if (mode) assert.equal(r.mode, mode);
    if (r.action === 'redirect') assert.ok(r.to.startsWith('/') && !r.to.startsWith('//'), 'same-origin redirect');
  });
}

test('decideYT: non-string path is hidden', () => assert.equal(decideYT(null).action, 'hide'));

test('mergeConfig: only a boolean ytHideHomeFeed is applied', () => {
  const c = { hideHomeFeed: false, hideShorts: true };
  assert.deepEqual(mergeConfig(c, { ytHideHomeFeed: 'yes', hideShorts: false, feedMode: 'off' }), []);
  assert.deepEqual(c, { hideHomeFeed: false, hideShorts: true });
  assert.deepEqual(mergeConfig(c, { ytHideHomeFeed: true, platform: 'ios-app' }), ['hideHomeFeed']);
  assert.equal(c.hideHomeFeed, true);
  assert.deepEqual(mergeConfig(c, null), []);
});
