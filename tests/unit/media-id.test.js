'use strict';
// mediaIdFromPath(): the media id bound to the D2 tap fallback (A01, rf-sec bypass #2) and used as
// the feed-cap key (S1). Must never extract an id from an ambiguous path.

const test = require('node:test');
const assert = require('node:assert/strict');
const { mediaIdFromPath } = require('../../web/instagram.js');

const CASES = [
  ['/reel/AbC_d-1/', 'AbC_d-1'],
  ['/reels/AbC123/', 'AbC123'],
  ['/tv/AbC123/', 'AbC123'],
  ['/p/AbC123/', 'AbC123'],
  ['/p/AbC123/c/1000/', 'AbC123'],
  ['/p/AbC123/?img_index=2', 'AbC123'],
  ['/user_1/reel/AbC123/', 'AbC123'],
  ['/user_1/tv/AbC123/', 'AbC123'],
  ['/user_1/p/AbC123/', 'AbC123'],
  ['/REEL/AbC123/', 'AbC123'],
  ['/reels/', null],
  ['/reels/audio/123/', null],
  ['/reels/AbC123/extra/', null],
  ['/', null],
  ['/user_1/', null],
  ['/direct/t/123/', null],
  ['/reel/a.b/', null],
  ['/reel/' + 'a'.repeat(65) + '/', null],
  ['/direct%2F..%2Freel/AbC123/', null],
  ['/reel/AbC%5C123/', null],
  ['/%2E%2E/reel/AbC123/', null],
  ['/reel/%E0%A4%A/', null],
  [null, null],
  [42, null],
];

for (const [input, want] of CASES) {
  test(`mediaIdFromPath(${JSON.stringify(input)}) === ${JSON.stringify(want)}`, () => {
    assert.equal(mediaIdFromPath(input), want);
  });
}
