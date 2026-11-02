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
const { decideYT } = require('../../web/youtube.js');

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

test('policy.json and youtube.json are in sync with tests/vectors/generate.cjs', () => {
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

// YouTube (Avenant 3): ctx = {config: {hideHomeFeed}}; path may carry ?query.
const ytVectors = JSON.parse(fs.readFileSync(path.join(__dirname, '../vectors/youtube.json'), 'utf8'));

test('youtube.json has at least 30 well-formed vectors with unique names', () => {
  assert.ok(ytVectors.length >= 30, `only ${ytVectors.length} vectors`);
  assert.equal(new Set(ytVectors.map((v) => v.name)).size, ytVectors.length);
  for (const v of ytVectors) assert.ok(['allow', 'redirect', 'hide'].includes(v.expect.action), v.name);
});

for (const v of ytVectors) {
  test(`youtube vector — ${v.name}`, () => {
    const r = decideYT(v.path, '', v.ctx);
    for (const [k, want] of Object.entries(v.expect)) assert.deepEqual(r[k], want, `${v.name} (${v.path}): ${k}`);
  });
}
