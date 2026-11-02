'use strict';
// Unit tests for decide(path, ctx) — T08.
// Contract: board/status/rf-qa.md, section "Demandes".
// Override the module under test with REELFREE_SRC=/abs/path/to/reelfree.user.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const SRC = process.env.REELFREE_SRC
  ? path.resolve(process.env.REELFREE_SRC)
  : path.join(__dirname, '../../web/instagram.js');

let decide = null;
let loadError = null;
try {
  const mod = require(SRC);
  if (mod && typeof mod.decide === 'function') {
    decide = mod.decide;
  } else {
    loadError = `${SRC} loaded but does not export a decide() function`;
  }
} catch (err) {
  loadError = `cannot load ${SRC}: ${err && err.message ? err.message.split('\n')[0] : err}`;
}

const SKIP = decide ? false : 'decide() not available';
const t = (name, fn) => test(name, { skip: SKIP }, fn);

const NOW = 1_800_000_000_000;
const THREAD = '/direct/t/123/';
const ACTIONS = new Set(['allow', 'redirect', 'hide']);

function ctx(over = {}) {
  return {
    now: NOW,
    token: null,
    lastThread: null,
    config: { blockExplore: true, dmReelTtlMs: 10000 },
    ...over,
  };
}

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

function assertShape(r, label = '') {
  assert.ok(r && typeof r === 'object', `${label}: result must be an object`);
  assert.ok(ACTIONS.has(r.action), `${label}: invalid action ${JSON.stringify(r.action)}`);
  if (r.action === 'redirect') {
    assert.equal(typeof r.to, 'string', `${label}: 'to' must be a string on redirect`);
    assert.ok(r.to.length > 0, `${label}: 'to' must be non-empty on redirect`);
  }
  assert.equal(typeof r.consumeToken, 'boolean', `${label}: consumeToken must be boolean`);
  assert.equal(typeof r.reason, 'string', `${label}: reason must be a string`);
  assert.ok(r.reason.length > 0, `${label}: reason must be non-empty`);
}

function expectRedirect(p, c, to, consumeToken) {
  const r = decide(p, c);
  assertShape(r, p);
  assert.equal(r.action, 'redirect', `${p}: expected redirect, got ${r.action}`);
  assert.equal(r.to, to, `${p}: wrong redirect target`);
  if (consumeToken !== undefined) assert.equal(r.consumeToken, consumeToken, `${p}: consumeToken`);
  return r;
}

function expectAllow(p, c, consumeToken) {
  const r = decide(p, c);
  assertShape(r, p);
  assert.equal(r.action, 'allow', `${p}: expected allow, got ${r.action}`);
  if (consumeToken !== undefined) assert.equal(r.consumeToken, consumeToken, `${p}: consumeToken`);
  return r;
}

// --- Module loading -------------------------------------------------------

test('web/instagram.js exports decide()', () => {
  assert.ok(decide, loadError || 'decide() not available');
});

// --- R2 -------------------------------------------------------------------

t('R2 — /reels/ redirects to /', () => expectRedirect('/reels/', ctx(), '/'));
t('R2 — /reels (no trailing slash) redirects to /', () => expectRedirect('/reels', ctx(), '/'));
t('R2 — /REELS/ (uppercase) redirects to /', () => expectRedirect('/REELS/', ctx(), '/'));
t('R2 — /reels/?foo=1 (querystring) redirects to /', () => expectRedirect('/reels/?foo=1', ctx(), '/'));
t('R2 — /reels/audio/123/ redirects to /', () => expectRedirect('/reels/audio/123/', ctx(), '/'));

// --- R3 -------------------------------------------------------------------

t('R3 — /reel/ABC/ without token, no lastThread, redirects to /', () =>
  expectRedirect('/reel/ABC/', ctx(), '/'));
t('R3 — /reels/ABC/ without token, no lastThread, redirects to /', () =>
  expectRedirect('/reels/ABC/', ctx(), '/'));
t('R3 — /reel/ABC/ without token redirects to lastThread', () =>
  expectRedirect('/reel/ABC/', ctx({ lastThread: THREAD }), THREAD));
t('R3 — /reels/ABC/ without token redirects to lastThread', () =>
  expectRedirect('/reels/ABC/', ctx({ lastThread: THREAD }), THREAD));

// --- R5 -------------------------------------------------------------------

for (const p of ['/explore/', '/explore/tags/x/', '/explore/locations/1/']) {
  t(`R5 — ${p} redirects to / when blockExplore is true`, () => expectRedirect(p, ctx(), '/'));
  t(`R5 — ${p} is allowed when blockExplore is false`, () =>
    expectAllow(p, ctx({ config: { blockExplore: false, dmReelTtlMs: 10000 } }), false));
}

// --- D2 -------------------------------------------------------------------

t('D2 — valid token (matching id, fresh) allows and consumes token', () =>
  expectAllow('/reel/ABC/', ctx({ token: { id: 'ABC', ts: NOW - 1000 }, lastThread: THREAD }), true));

t('D2 — token exactly at TTL boundary (now - 10000) allows', () =>
  expectAllow('/reel/ABC/', ctx({ token: { id: 'ABC', ts: NOW - 10000 } }), true));

t('D2 — token expired by 1 ms (now - 10001) redirects and consumes token', () =>
  expectRedirect('/reel/ABC/', ctx({ token: { id: 'ABC', ts: NOW - 10001 } }), '/', true));

t('D2 — expired token redirects to lastThread when set', () =>
  expectRedirect('/reel/ABC/', ctx({ token: { id: 'ABC', ts: NOW - 10001 }, lastThread: THREAD }), THREAD, true));

t('D2 — token with wrong id redirects and consumes token', () =>
  expectRedirect('/reel/ABC/', ctx({ token: { id: 'XYZ', ts: NOW - 1000 } }), '/', true));

t('D2 — custom config.dmReelTtlMs is respected', () => {
  const config = { blockExplore: true, dmReelTtlMs: 2000 };
  expectAllow('/reel/ABC/', ctx({ token: { id: 'ABC', ts: NOW - 2000 }, config }), true);
  expectRedirect('/reel/ABC/', ctx({ token: { id: 'ABC', ts: NOW - 2001 }, config }), '/', true);
  // A token that would be valid with the default 10 s TTL must be rejected with 2 s.
  expectRedirect('/reel/ABC/', ctx({ token: { id: 'ABC', ts: NOW - 5000 }, config }), '/', true);
});

t('D2 — token is one-shot: second use of the same path redirects', () => {
  const store = { token: { id: 'ABC', ts: NOW - 500 } };
  const apply = (r) => { if (r.consumeToken) store.token = null; };

  const first = expectAllow('/reel/ABC/', ctx({ token: store.token, lastThread: THREAD }), true);
  apply(first);
  assert.equal(store.token, null, 'token must be consumed after first use');

  const second = expectRedirect('/reel/ABC/', ctx({ token: store.token, lastThread: THREAD }), THREAD);
  apply(second);
});

// --- D3 -------------------------------------------------------------------

t('D3 — token for reel A, navigation to reel B redirects to lastThread', () =>
  expectRedirect('/reel/BBB/', ctx({ token: { id: 'AAA', ts: NOW - 1000 }, lastThread: THREAD }), THREAD, true));

t('D3 — token for reel A, navigation to /reels/B/ redirects to lastThread', () =>
  expectRedirect('/reels/BBB/', ctx({ token: { id: 'AAA', ts: NOW - 1000 }, lastThread: THREAD }), THREAD, true));

// --- Allowed routes -------------------------------------------------------

for (const p of ['/', '/direct/inbox/', '/direct/t/123/', '/someuser/', '/p/ABC/',
  '/stories/someuser/123/', '/accounts/edit/']) {
  t(`Allow — ${p} is allowed without consuming token`, () => expectAllow(p, ctx(), false));
}

// --- Shape ----------------------------------------------------------------

t('Shape — every result has a valid action, to, consumeToken and reason', () => {
  const cases = [
    ['/', ctx()],
    ['/reels/', ctx()],
    ['/reel/ABC/', ctx()],
    ['/reel/ABC/', ctx({ token: { id: 'ABC', ts: NOW } })],
    ['/reel/ABC/', ctx({ token: { id: 'ABC', ts: NOW - 99999 }, lastThread: THREAD })],
    ['/explore/', ctx()],
    ['/explore/', ctx({ config: { blockExplore: false, dmReelTtlMs: 10000 } })],
    ['/direct/t/123/', ctx({ lastThread: THREAD })],
    ['/someuser/', ctx()],
  ];
  for (const [p, c] of cases) assertShape(decide(p, c), p);
});

// --- Purity ---------------------------------------------------------------

t('Purity — equal inputs give deep-equal results', () => {
  const paths = ['/', '/reels/', '/reel/ABC/', '/reel/BBB/', '/explore/', '/direct/t/123/'];
  for (const p of paths) {
    const mk = () => ctx({ token: { id: 'ABC', ts: NOW - 1000 }, lastThread: THREAD });
    assert.deepEqual(decide(p, mk()), decide(p, mk()), `${p}: non-deterministic result`);
  }
});

t('Purity — ctx is not mutated (deep-frozen input)', () => {
  const paths = ['/', '/reels/', '/reel/ABC/', '/reel/BBB/', '/explore/', '/direct/t/123/'];
  for (const p of paths) {
    const c = deepFreeze(ctx({ token: { id: 'ABC', ts: NOW - 1000 }, lastThread: THREAD }));
    const snapshot = structuredClone(c);
    assert.doesNotThrow(() => decide(p, c), `${p}: decide threw on a frozen ctx`);
    assert.deepEqual(c, snapshot, `${p}: ctx was mutated`);
  }
});
