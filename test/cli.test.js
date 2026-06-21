'use strict';

// CLI surface (workflow-facing): resolve-release / rollback-target / buildCertificate.
// Ported + extended from the editor's old versioning.test.js (which targeted lib/ci.js).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const RPV = path.resolve(__dirname, '..', 'index.js');
const run = (...args) => execFileSync('node', [RPV, ...args], { encoding: 'utf8' }).trim();
const scheme = require('../lib/scheme');

test('resolve-release yields a consistent {version, tag, createTag}', () => {
  const r = JSON.parse(run('resolve-release', '--release=minor'));
  assert.match(r.version, /^\d+\.\d+\.\d+$/);
  assert.equal(r.tag, `v${r.version}`);
  assert.equal(typeof r.createTag, 'boolean');
});

test('rollback-target requires a from-version (exit 2)', () => {
  let status = 0;
  try { run('rollback-target'); } catch (e) { status = e.status; }
  assert.equal(status, 2);
});

test('rollback-target errors (exit 1) when there is no earlier release', () => {
  let status = 0;
  try { run('rollback-target', '1.0.0', 'minor'); } catch (e) { status = e.status; }
  assert.equal(status, 1);
});

test('unknown command prints usage (exit 2)', () => {
  let status = 0;
  try { run('frobnicate'); } catch (e) { status = e.status; }
  assert.equal(status, 2);
});

test('buildCertificate co-locates version + SHA and includes name when given', () => {
  const cert = scheme.buildCertificate({ version: '9.9.9', channel: 'production', name: 'editor' });
  assert.equal(cert.version, '9.9.9');
  assert.equal(cert.channel, 'production');
  assert.equal(cert.name, 'editor');
  assert.match(cert.gitCommit, /^[0-9a-f]{7,40}$/);
  // name omitted when not provided
  assert.equal('name' in scheme.buildCertificate({ version: '1.0.0', channel: 'local' }), false);
});
