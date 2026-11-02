#!/usr/bin/env node
// `npm test`: unit tests (node:test) then E2E (Playwright WebKit, iPhone 11).
// Writes a one-line summary to board/last-test.txt, e.g.
//   PASS 12/12 — 2026-11-02 14:03
//   FAIL 9/12 — 2026-11-02 14:03 — unit 7/8, e2e 2/4
// Exit code 1 if anything failed. Skipped tests count as not passed.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'board/last-test.txt');
const env = { ...process.env, PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS: '1', FORCE_COLOR: '0' };

function run(cmd, args, extraEnv = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, env: { ...env, ...extraEnv }, encoding: 'utf8', maxBuffer: 64 << 20 });
  return { code: r.status ?? 1, out: (r.stdout || '') + (r.stderr || '') };
}

// --- unit -------------------------------------------------------------------
const unitFiles = fs.existsSync(path.join(ROOT, 'tests/unit'))
  ? fs.readdirSync(path.join(ROOT, 'tests/unit')).filter((f) => f.endsWith('.test.js') || f.endsWith('.test.mjs'))
  : [];
let unit = { pass: 0, total: 0, ok: true };
if (unitFiles.length) {
  const r = run(process.execPath, ['--test', '--test-reporter=tap', ...unitFiles.map((f) => `tests/unit/${f}`)]);
  process.stdout.write(r.out);
  const n = (k) => Number((r.out.match(new RegExp(`^# ${k} (\\d+)`, 'm')) || [])[1] || 0);
  unit = { pass: n('pass'), total: n('tests'), ok: r.code === 0 && n('fail') === 0 && n('skipped') === 0 };
  if (unit.total === 0) unit.ok = false;
}

// --- e2e --------------------------------------------------------------------
const jsonFile = path.join(ROOT, `test-results/e2e-${process.pid}.json`);
fs.mkdirSync(path.dirname(jsonFile), { recursive: true });
fs.rmSync(jsonFile, { force: true });
const e = run(path.join(ROOT, 'node_modules/.bin/playwright'),
  ['test', '-c', 'tests/playwright.config.mjs', '--reporter=list,json'],
  { PLAYWRIGHT_JSON_OUTPUT_NAME: jsonFile });
process.stdout.write(e.out);
let e2e = { pass: 0, total: 0, ok: false };
try {
  const s = JSON.parse(fs.readFileSync(jsonFile, 'utf8')).stats;
  const total = s.expected + s.unexpected + s.flaky + s.skipped;
  e2e = { pass: s.expected, total, ok: e.code === 0 && s.unexpected === 0 && s.skipped === 0 && total > 0 };
} catch {
  // Playwright crashed before reporting (e.g. WebKit cannot launch): count as one failure.
  e2e = { pass: 0, total: 1, ok: false };
}

// --- summary ----------------------------------------------------------------
const pass = unit.pass + e2e.pass;
const total = unit.total + e2e.total;
const ok = unit.ok && e2e.ok;
const d = new Date();
const pad = (x) => String(x).padStart(2, '0');
const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const line = ok
  ? `PASS ${pass}/${total} — ${stamp}`
  : `FAIL ${pass}/${total} — ${stamp} — unit ${unit.pass}/${unit.total}, e2e ${e2e.pass}/${e2e.total}`;
fs.writeFileSync(OUT, line + '\n');
console.log('\n' + line);
process.exit(ok ? 0 : 1);
