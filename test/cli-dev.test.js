'use strict';

// Developer CLI: push / rollback (the local triggers). All run with --dry-run so nothing is
// pushed or deployed. Ported from the editor's version-cli.test.js when the toolkit became a package.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const CLI = path.resolve(__dirname, '..', 'index.js');
function run(...args) {
  try { return { code: 0, out: execFileSync('node', [CLI, ...args], { encoding: 'utf8' }) }; }
  catch (e) { return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` }; }
}

test('unknown command → usage (exit 2)', () => {
  const r = run('nope');
  assert.strictEqual(r.code, 2);
  assert.match(r.out, /push .*rollback|rpv <command>/);
});

test('push (default) → git push to staging', () => {
  const r = run('push', '--dry-run');
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /git push/);
  assert.match(r.out, /STAGING/i);
});

test('push --production → minor release on production.yml', () => {
  const r = run('push', '--production', '--dry-run');
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /production\.yml/);
  assert.match(r.out, /release_type=minor/);
  assert.match(r.out, /confirm=production/);
});

test('push --production --major → major release', () => {
  assert.match(run('push', '--production', '--major', '--dry-run').out, /release_type=major/);
});

test('--major without --production is rejected (exit 2)', () => {
  assert.strictEqual(run('push', '--major', '--dry-run').code, 2);
});

test('push with both --staging and --production is rejected (exit 2)', () => {
  assert.strictEqual(run('push', '--staging', '--production', '--dry-run').code, 2);
});

test('rollback requires a version (exit 2)', () => {
  assert.strictEqual(run('rollback', '--production').code, 2);
});

test('rollback requires an explicit environment (exit 2)', () => {
  assert.strictEqual(run('rollback', '1.3.0', '--dry-run').code, 2);
});

test('rollback 1.3.0 --production → production.yml rollback', () => {
  const r = run('rollback', '1.3.0', '--production', '--dry-run');
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /production\.yml/);
  assert.match(r.out, /rollback=1\.3\.0/);
});
