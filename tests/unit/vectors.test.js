'use strict';
// Runs the shared route-policy vectors (tests/vectors/policy.json, docs/SPEC-iOS.md) against
// web/instagram.js decide(). RoutePolicy.swift runs the very same file in XCTest.
// ctx: {token: {id, ageMs}, lastThread, activeReel, config}; expect: only the keys present are compared.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { decide } = require('../../web/instagram.js');

const FILE = path.join(__dirname, '../vectors/policy.json');
const NOW = 1_800_000_000_000;
const vectors = JSON.parse(fs.readFileSync(FILE, 'utf8'));

function toDecideCtx(c) {
  return {
    now: NOW,
    token: c.token ? { id: c.token.id, ts: NOW - c.token.ageMs } : null,
    lastThread: 'lastThread' in c ? c.lastThread : null,
    activeReel: 'activeReel' in c ? c.activeReel : null,
    config: c.config,
  };
}

test('policy.json has at least 40 well-formed vectors with unique names', () => {
  assert.ok(Array.isArray(vectors) && vectors.length >= 40, `only ${vectors.length} vectors`);
  const names = new Set();
  for (const v of vectors) {
    assert.equal(typeof v.name, 'string');
    assert.ok(!names.has(v.name), `duplicate vector name: ${v.name}`);
    names.add(v.name);
    assert.equal(typeof v.path, 'string', v.name);
    assert.equal(typeof v.ctx, 'object', v.name);
    assert.ok(['allow', 'redirect', 'hide'].includes(v.expect.action), v.name);
  }
});

test('policy.json is in sync with tests/vectors/generate.cjs', () => {
  execFileSync(process.execPath, [path.join(__dirname, '../vectors/generate.cjs'), '--check'], { stdio: 'pipe' });
});

for (const v of vectors) {
  test(`vector — ${v.name}`, () => {
    const r = decide(v.path, toDecideCtx(v.ctx));
    for (const [k, want] of Object.entries(v.expect)) {
      assert.deepEqual(r[k], want, `${v.name} (${v.path}): ${k}`);
    }
  });
}
