'use strict';
// mergeConfig(): window.RF_CONFIG and {type: "config"} messages from the app (docs/SPEC-iOS.md).
// Only known keys with valid values may change the script's CONFIG.

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeConfig } = require('../../web/instagram.js');

const base = () => ({ feedMode: 'limited', feedLimit: 15, blockExplore: true, dmReelTtlMs: 10000, feedVariant: 'following' });

test('valid keys are applied and reported', () => {
  const c = base();
  const changed = mergeConfig(c, { feedMode: 'off', feedLimit: 7.9, blockExplore: false, dmReelTtlMs: 3000, feedVariant: 'default', platform: 'ios-app' });
  assert.deepEqual(c, { feedMode: 'off', feedLimit: 7, blockExplore: false, dmReelTtlMs: 3000, feedVariant: 'default' });
  assert.deepEqual(changed.sort(), ['blockExplore', 'dmReelTtlMs', 'feedLimit', 'feedMode', 'feedVariant']);
});

test('unchanged values are not reported', () => {
  assert.deepEqual(mergeConfig(base(), { feedMode: 'limited', feedLimit: 15 }), []);
});

test('invalid values and unknown keys are ignored', () => {
  const c = base();
  const changed = mergeConfig(c, {
    feedMode: 'infinite', feedLimit: -1, blockExplore: 'false', dmReelTtlMs: 1e9, feedVariant: 'x',
    __proto__: { feedMode: 'off' }, constructor: 1, platform: 'ios-app',
  });
  assert.deepEqual(changed, []);
  assert.deepEqual(c, base());
});

test('non-finite numbers are ignored', () => {
  const c = base();
  mergeConfig(c, { feedLimit: NaN, dmReelTtlMs: Infinity });
  assert.deepEqual(c, base());
});

test('non-object input is a no-op', () => {
  for (const v of [null, undefined, 'feedMode=off', 42, true]) assert.deepEqual(mergeConfig(base(), v), []);
});
