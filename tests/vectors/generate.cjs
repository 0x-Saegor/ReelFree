#!/usr/bin/env node
'use strict';
// Builds the shared route-policy vectors (docs/SPEC-iOS.md):
//   tests/vectors/policy.json   Instagram, web/instagram.js decide()
//   tests/vectors/youtube.json  YouTube, web/youtube.js decideYT() (Avenant 3)
// Each case states the expected action (and redirect target) by hand, from docs/SPEC.md; the
// remaining keys (consumeToken, reason, mode, reelId) are taken from the JS policy and frozen into
// the JSON, so the Swift ports must reproduce them exactly.
// The script refuses to write if the JS policy disagrees with a hand-written expectation.
//
//   node tests/vectors/generate.cjs          # rewrite both files
//   node tests/vectors/generate.cjs --check  # exit 1 if a file is stale

const fs = require('node:fs');
const path = require('node:path');
const { decide } = require('../../web/instagram.js');
const { decideYT } = require('../../web/youtube.js');

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

  // Avenants 2 et 4: history traversal (ctx.via = "popstate") spends any pending token without
  // admitting a media. Ports drop ctx.token before deciding (see toDecideCtx).
  ['P popstate reel with valid token', `/reel/${ID}/`, { ...tok(ID, 1000), via: 'popstate' }, { action: 'redirect', to: '/' }],
  ['P popstate reel with valid token returns to lastThread', `/reel/${ID}/`, { ...tok(ID, 1000), lastThread: T, via: 'popstate' }, { action: 'redirect', to: T }],
  ['P popstate reels/<id> with valid token', `/reels/${ID}/`, { ...tok(ID, 1000), lastThread: T, via: 'popstate' }, { action: 'redirect', to: T }],
  ['P popstate profile reel with valid token', `/someuser/reel/${ID}/`, { ...tok(ID, 1000), via: 'popstate' }, { action: 'redirect', to: '/' }],
  ['P popstate tv/<id> with valid token', `/tv/${ID}/`, { ...tok(ID, 1000), via: 'popstate' }, { action: 'redirect', to: '/' }],
  ['P popstate /p/ with valid token: plain post, no reel admitted', `/p/${ID}/`, { ...tok(ID, 1000), lastThread: T, via: 'popstate' }, { action: 'allow' }],
  ['P popstate to the thread', T, { ...tok(ID, 1000), via: 'popstate' }, { action: 'allow' }],
  ['P popstate reel without token', `/reel/${ID}/`, { via: 'popstate' }, { action: 'redirect', to: '/' }],

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
  if (c.token && c.via !== 'popstate') out.token = { id: c.token.id, ts: NOW - c.token.ageMs };
  if ('lastThread' in c) out.lastThread = c.lastThread;
  if ('activeReel' in c) out.activeReel = c.activeReel;
  if (c.config) out.config = c.config;
  return out;
}

// YouTube. ctx: {config: {hideHomeFeed}} (native setting ytHideHomeFeed; default false).
// path may carry ?query (ignored by the policy, never copied into 'to').
const VID = 'dQw4w9WgXcQ';
const CH = 'UC' + 'a'.repeat(22);
const YT_CASES = [
  ['Y home', '/', {}, { action: 'allow' }],
  ['Y home with query', '/?app=m', {}, { action: 'allow' }],
  ['Y home hidden (ytHideHomeFeed)', '/', { config: { hideHomeFeed: true } }, { action: 'allow' }],
  ['Y watch', `/watch?v=${VID}`, {}, { action: 'allow' }],
  ['Y watch with timestamp', `/watch?v=${VID}&t=42`, {}, { action: 'allow' }],
  ['Y search results', '/results?search_query=x', {}, { action: 'allow' }],
  ['Y subscriptions feed', '/feed/subscriptions', {}, { action: 'allow' }],
  ['Y library', '/feed/library', {}, { action: 'allow' }],
  ['Y channel by handle', '/@someone', {}, { action: 'allow' }],
  ['Y channel videos tab', '/@someone/videos', {}, { action: 'allow' }],
  ['Y channel by id', `/channel/${CH}`, {}, { action: 'allow' }],
  ['Y playlist', '/playlist?list=PL123', {}, { action: 'allow' }],
  ['Y path containing shorts as a word', '/@shortsfan', {}, { action: 'allow' }],
  ['Y short to watch', `/shorts/${VID}`, {}, { action: 'redirect', to: `/watch?v=${VID}` }],
  ['Y short trailing slash', `/shorts/${VID}/`, {}, { action: 'redirect', to: `/watch?v=${VID}` }],
  ['Y short uppercase prefix', `/SHORTS/${VID}`, {}, { action: 'redirect', to: `/watch?v=${VID}` }],
  ['Y short with share query (dropped)', `/shorts/${VID}?feature=share&si=x`, {}, { action: 'redirect', to: `/watch?v=${VID}` }],
  ['Y short with fragment', `/shorts/${VID}#x`, {}, { action: 'redirect', to: `/watch?v=${VID}` }],
  ['Y short matrix param', `/shorts;x/${VID}`, {}, { action: 'redirect', to: `/watch?v=${VID}` }],
  ['Y short id case preserved', '/shorts/AbCdEfGhIjK', {}, { action: 'redirect', to: '/watch?v=AbCdEfGhIjK' }],
  ['Y shorts root', '/shorts/', {}, { action: 'redirect', to: '/' }],
  ['Y shorts no slash', '/shorts', {}, { action: 'redirect', to: '/' }],
  ['Y short id too short', '/shorts/tooShort', {}, { action: 'redirect', to: '/' }],
  ['Y short id too long', `/shorts/${VID}X`, {}, { action: 'redirect', to: '/' }],
  ['Y short id with injected query', '/shorts/abc%26v%3Dx12', {}, { action: 'redirect', to: '/' }],
  ['Y shorts feed', '/feed/shorts', {}, { action: 'redirect', to: '/' }],
  ['Y channel shorts tab (handle)', '/@someone/shorts', {}, { action: 'redirect', to: '/@someone' }],
  ['Y channel shorts tab (id)', `/channel/${CH}/shorts`, {}, { action: 'redirect', to: `/channel/${CH}` }],
  ['Y channel shorts tab (c)', '/c/Name_1/shorts', {}, { action: 'redirect', to: '/c/Name_1' }],
  ['Y channel shorts tab (user)', '/user/Name.1/shorts', {}, { action: 'redirect', to: '/user/Name.1' }],
  ['Y channel shorts tab, invalid handle', '/@a%20b/shorts', {}, { action: 'redirect', to: '/' }],
  ['Y channel shorts tab, invalid channel id', '/channel/UCshort/shorts', {}, { action: 'redirect', to: '/' }],
  ['Y channel shorts tab, dots-only name', '/user/../shorts', {}, { action: 'hide' }],
  ['Y encoded slash', `/shorts%2F${VID}`, {}, { action: 'hide' }],
  ['Y encoded traversal', '/user/..%2F..%2Fx/shorts', {}, { action: 'hide' }],
  ['Y encoded protocol-relative', '/%2F%2Fevil.example/shorts', {}, { action: 'hide' }],
  ['Y encoded backslash', '/%5Cshorts', {}, { action: 'hide' }],
  ['Y dot-dot segment', `/x/../shorts/${VID}`, {}, { action: 'hide' }],
  ['Y invalid percent-encoding', '/%E0%A4%A', {}, { action: 'hide' }],
  ['Y lowercase encoded slash', `/shorts%2f${VID}`, {}, { action: 'hide' }],
];

function build(cases, run, keys, wantKeys) {
  const vectors = [];
  const errors = [];
  const names = new Set();
  for (const [name, p, ctx, want] of cases) {
    if (names.has(name)) errors.push(`duplicate name: ${name}`);
    names.add(name);
    const r = run(p, ctx);
    if (r.action !== want.action || ('to' in want && r.to !== want.to)) {
      errors.push(`${name}: want ${JSON.stringify(want)}, policy gave ${JSON.stringify(r)}`);
    }
    const expect = { action: r.action };
    if (r.action === 'redirect') expect.to = r.to;
    for (const k of keys) expect[k] = r[k];
    vectors.push({ name, path: p, ctx, expect });
  }
  return { vectors, errors };
}

const OUTPUTS = [
  ['policy.json', build(CASES, (p, c) => decide(p, toDecideCtx(c)), ['consumeToken', 'reason', 'mode', 'reelId'])],
  ['youtube.json', build(YT_CASES, (p, c) => decideYT(p, '', c), ['reason', 'mode'])],
];

const errors = OUTPUTS.flatMap(([, b]) => b.errors);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

let stale = false;
for (const [file, { vectors }] of OUTPUTS) {
  const out = path.join(__dirname, file);
  const text = '[\n' + vectors.map((v) => '  ' + JSON.stringify(v)).join(',\n') + '\n]\n';
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    if (cur !== text) { console.error(`tests/vectors/${file} is stale: run node tests/vectors/generate.cjs`); stale = true; }
    else console.log(`${file} up to date (${vectors.length} vectors)`);
  } else {
    fs.writeFileSync(out, text);
    console.log(`wrote tests/vectors/${file} (${vectors.length} vectors)`);
  }
}
process.exit(stale ? 1 : 0);
