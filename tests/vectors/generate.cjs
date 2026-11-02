#!/usr/bin/env node
'use strict';
// Builds tests/vectors/policy.json, the shared route-policy vectors (docs/SPEC-iOS.md).
// Each case states the expected action (and redirect target) by hand, from docs/SPEC.md; the
// remaining keys (consumeToken, reason, mode, reelId) are taken from web/instagram.js decide()
// and frozen into the JSON, so RoutePolicy.swift must reproduce them exactly.
// The script refuses to write if decide() disagrees with a hand-written expectation.
//
//   node tests/vectors/generate.cjs          # rewrite policy.json
//   node tests/vectors/generate.cjs --check  # exit 1 if policy.json is stale

const fs = require('node:fs');
const path = require('node:path');
const { decide } = require('../../web/instagram.js');

const OUT = path.join(__dirname, 'policy.json');
const NOW = 1_800_000_000_000;
const T = '/direct/t/123/';
const ID = 'AbCdE12345';
const ID2 = 'ZyXwV98765';
const tok = (id, ageMs) => ({ token: { id, ageMs } });

// [name, path, ctx, want] — want: {action, to?}
const CASES = [
  // R2: Reels feed and sub-routes.
  ['R2 reels feed', '/reels/', {}, { action: 'redirect', to: '/' }],
  ['R2 reels no trailing slash', '/reels', {}, { action: 'redirect', to: '/' }],
  ['R2 reels uppercase', '/REELS/', {}, { action: 'redirect', to: '/' }],
  ['R2 reels with query', '/reels/?foo=1', {}, { action: 'redirect', to: '/' }],
  ['R2 reels with fragment', '/reels/#x', {}, { action: 'redirect', to: '/' }],
  ['R2 reels audio', '/reels/audio/123/', {}, { action: 'redirect', to: '/' }],
  ['R2 reels matrix param', '/reels;x=1/', {}, { action: 'redirect', to: '/' }],
  ['R2 reels percent-encoded letter', '/r%65els/', {}, { action: 'redirect', to: '/' }],
  ['R2 reels double slash', '//reels/', {}, { action: 'redirect', to: '/' }],
  ['R2 bare /reel/', '/reel/', {}, { action: 'redirect', to: '/' }],
  ['R2 bare /tv/', '/tv/', {}, { action: 'redirect', to: '/' }],
  ['R2 reels feed ignores lastThread', '/reels/', { lastThread: T }, { action: 'redirect', to: '/' }],
  ['R2 profile reels tab', '/someuser/reels/', {}, { action: 'redirect', to: '/someuser/' }],
  ['R2 profile reels tab, dotted username', '/some.user_1/reels/', {}, { action: 'redirect', to: '/some.user_1/' }],
  ['R2 profile reels tab, invalid username (no open redirect)', '/a%20b/reels/', {}, { action: 'redirect', to: '/' }],
  ['R2 profile bare /reel/', '/someuser/reel/', {}, { action: 'redirect', to: '/someuser/' }],

  // R3: a single reel outside DMs.
  ['R3 reel without token', `/reel/${ID}/`, {}, { action: 'redirect', to: '/' }],
  ['R3 reels/<id> without token', `/reels/${ID}/`, {}, { action: 'redirect', to: '/' }],
  ['R3 tv/<id> without token', `/tv/${ID}/`, {}, { action: 'redirect', to: '/' }],
  ['R3 reel without token returns to lastThread', `/reel/${ID}/`, { lastThread: T }, { action: 'redirect', to: T }],
  ['R3 reels/<id> without token returns to lastThread', `/reels/${ID}/`, { lastThread: T }, { action: 'redirect', to: T }],
  ['R3 profile reel without token', `/someuser/reel/${ID}/`, {}, { action: 'redirect', to: '/' }],
  ['R3 profile tv without token', `/someuser/tv/${ID}/`, {}, { action: 'redirect', to: '/' }],
  ['R3 reel with invalid id', '/reel/a.b/', {}, { action: 'redirect', to: '/' }],
  ['R3 reel id too long', `/reel/${'a'.repeat(65)}/`, {}, { action: 'redirect', to: '/' }],
  ['R3 lastThread not a thread path is ignored', `/reel/${ID}/`, { lastThread: 'https://evil.example/' }, { action: 'redirect', to: '/' }],
  ['R3 lastThread with dot-segments is ignored', `/reel/${ID}/`, { lastThread: '/direct/t/../../x/' }, { action: 'redirect', to: '/' }],
  ['R3 lastThread protocol-relative is ignored', `/reel/${ID}/`, { lastThread: '//evil.example/direct/t/1/' }, { action: 'redirect', to: '/' }],

  // R5: Explore.
  ['R5 explore', '/explore/', {}, { action: 'redirect', to: '/' }],
  ['R5 explore tags', '/explore/tags/x/', {}, { action: 'redirect', to: '/' }],
  ['R5 explore locations', '/explore/locations/1/', {}, { action: 'redirect', to: '/' }],
  ['R5 explore keyword results', '/explore/search/keyword/', {}, { action: 'redirect', to: '/' }],
  ['R5 explore account search allowed', '/explore/search/', {}, { action: 'allow' }],
  ['R5 explore allowed when blockExplore off', '/explore/', { config: { blockExplore: false } }, { action: 'allow' }],
  ['R5 explore tags allowed when blockExplore off', '/explore/tags/x/', { config: { blockExplore: false } }, { action: 'allow' }],

  // D2: one-shot token from a DM click.
  ['D2 reel with valid token', `/reel/${ID}/`, { ...tok(ID, 2000), lastThread: T }, { action: 'allow' }],
  ['D2 reels/<id> with valid token', `/reels/${ID}/`, { ...tok(ID, 2000), lastThread: T }, { action: 'allow' }],
  ['D2 profile reel with valid token', `/someuser/reel/${ID}/`, { ...tok(ID, 2000), lastThread: T }, { action: 'allow' }],
  ['D2 token of age 0', `/reel/${ID}/`, tok(ID, 0), { action: 'allow' }],
  ['D2 token exactly at TTL', `/reel/${ID}/`, tok(ID, 10000), { action: 'allow' }],
  ['D2 token expired by 1 ms', `/reel/${ID}/`, tok(ID, 10001), { action: 'redirect', to: '/' }],
  ['D2 expired token returns to lastThread', `/reel/${ID}/`, { ...tok(ID, 10001), lastThread: T }, { action: 'redirect', to: T }],
  ['D2 token from the future is refused', `/reel/${ID}/`, tok(ID, -1000), { action: 'redirect', to: '/' }],
  ['D2 token for another id', `/reel/${ID}/`, tok(ID2, 1000), { action: 'redirect', to: '/' }],
  ['D2 token id is case-sensitive', `/reel/${ID}/`, tok(ID.toLowerCase(), 1000), { action: 'redirect', to: '/' }],
  ['D2 custom TTL accepts at boundary', `/reel/${ID}/`, { ...tok(ID, 2000), config: { dmReelTtlMs: 2000 } }, { action: 'allow' }],
  ['D2 custom TTL refuses past boundary', `/reel/${ID}/`, { ...tok(ID, 2001), config: { dmReelTtlMs: 2000 } }, { action: 'redirect', to: '/' }],
  ['D2 custom TTL refuses a default-valid token', `/reel/${ID}/`, { ...tok(ID, 5000), config: { dmReelTtlMs: 2000 } }, { action: 'redirect', to: '/' }],
  ['D2 reel served as /p/ with valid token', `/p/${ID}/`, { ...tok(ID, 1000), lastThread: T }, { action: 'allow' }],
  ['D2 reel served as /<user>/p/ with valid token', `/someuser/p/${ID}/`, { ...tok(ID, 1000), lastThread: T }, { action: 'allow' }],
  ['D2 same reel re-evaluated (activeReel)', `/reel/${ID}/`, { activeReel: ID, lastThread: T }, { action: 'allow' }],
  ['D2 same /p/ re-evaluated (activeReel)', `/p/${ID}/`, { activeReel: ID, lastThread: T }, { action: 'allow' }],

  // D3: no chaining from an admitted reel.
  ['D3 token for A, navigation to reel B', `/reel/${ID2}/`, { ...tok(ID, 1000), lastThread: T }, { action: 'redirect', to: T }],
  ['D3 token for A, navigation to reels/B', `/reels/${ID2}/`, { ...tok(ID, 1000), lastThread: T }, { action: 'redirect', to: T }],
  ['D3 active reel A, navigation to reel B', `/reel/${ID2}/`, { activeReel: ID, lastThread: T }, { action: 'redirect', to: T }],
  ['D3 active reel A, navigation to /p/B', `/p/${ID2}/`, { activeReel: ID, lastThread: T }, { action: 'redirect', to: T }],
  ['D3 active reel A, navigation to /<user>/p/B', `/someuser/p/${ID2}/`, { activeReel: ID, lastThread: T }, { action: 'redirect', to: T }],
  ['D3 active reel A, navigation to /p/B without thread', `/p/${ID2}/`, { activeReel: ID }, { action: 'redirect', to: '/' }],

  // X3: malformed or ambiguous paths fail closed.
  ['X3 encoded slash', '/direct%2F..%2Freels/', {}, { action: 'hide' }],
  ['X3 encoded backslash', '/%5Creels/', {}, { action: 'hide' }],
  ['X3 encoded dot-dot', '/direct/%2E%2E/reels/', {}, { action: 'hide' }],
  ['X3 dot-dot segment', '/direct/../reels/', {}, { action: 'hide' }],
  ['X3 dot segment', '/./reels/', {}, { action: 'hide' }],
  ['X3 invalid percent-encoding', '/%E0%A4%A/', {}, { action: 'hide' }],
  ['X3 lowercase encoded slash', '/direct%2f..%2freels/', {}, { action: 'hide' }],

  // Allowed routes.
  ['Allow home feed', '/', {}, { action: 'allow' }],
  ['Allow home feed, following variant', '/?variant=following', {}, { action: 'allow' }],
  ['Allow home feed off', '/', { config: { feedMode: 'off' } }, { action: 'allow' }],
  ['Allow DM inbox', '/direct/inbox/', {}, { action: 'allow' }],
  ['Allow DM thread', T, {}, { action: 'allow' }],
  ['Allow DM thread with lastThread', T, { lastThread: T }, { action: 'allow' }],
  ['Allow profile', '/someuser/', {}, { action: 'allow' }],
  ['Allow post', `/p/${ID}/`, {}, { action: 'allow' }],
  ['Allow post with token for another id', `/p/${ID}/`, tok(ID2, 1000), { action: 'allow' }],
  ['Allow profile post', `/someuser/p/${ID}/`, {}, { action: 'allow' }],
  ['Allow stories', '/stories/someuser/123/', {}, { action: 'allow' }],
  ['Allow account settings', '/accounts/edit/', {}, { action: 'allow' }],
  ['Allow notifications', '/accounts/activity/', {}, { action: 'allow' }],
  ['Allow path containing "reels" as username', '/reelsfan/', {}, { action: 'allow' }],
];

function toDecideCtx(c) {
  const out = { now: NOW, token: null, lastThread: null, activeReel: null };
  if (c.token) out.token = { id: c.token.id, ts: NOW - c.token.ageMs };
  if ('lastThread' in c) out.lastThread = c.lastThread;
  if ('activeReel' in c) out.activeReel = c.activeReel;
  if (c.config) out.config = c.config;
  return out;
}

const vectors = [];
const errors = [];
const names = new Set();
for (const [name, p, ctx, want] of CASES) {
  if (names.has(name)) errors.push(`duplicate name: ${name}`);
  names.add(name);
  const r = decide(p, toDecideCtx(ctx));
  if (r.action !== want.action || ('to' in want && r.to !== want.to)) {
    errors.push(`${name}: want ${JSON.stringify(want)}, decide() gave ${JSON.stringify(r)}`);
  }
  const expect = { action: r.action };
  if (r.action === 'redirect') expect.to = r.to;
  Object.assign(expect, { consumeToken: r.consumeToken, reason: r.reason, mode: r.mode, reelId: r.reelId });
  vectors.push({ name, path: p, ctx, expect });
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

const text = '[\n' + vectors.map((v) => '  ' + JSON.stringify(v)).join(',\n') + '\n]\n';
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (cur !== text) { console.error('tests/vectors/policy.json is stale: run node tests/vectors/generate.cjs'); process.exit(1); }
  console.log(`policy.json up to date (${vectors.length} vectors)`);
} else {
  fs.writeFileSync(OUT, text);
  console.log(`wrote ${path.relative(process.cwd(), OUT)} (${vectors.length} vectors)`);
}
