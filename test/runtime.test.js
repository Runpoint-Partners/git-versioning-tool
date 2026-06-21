'use strict';

// runtime.readVersion: honest sentinels when unstamped, reads the stamp file, env wins,
// and name precedence (stamp.name > passed name > 'app').

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readVersion } = require('../lib/runtime');

const cleanEnv = () => {
  for (const k of ['AAA_VERSION', 'AAA_CHANNEL', 'AAA_GIT_COMMIT', 'AAA_BUILT_AT']) delete process.env[k];
};

test('unstamped → honest sentinels (no fake data)', () => {
  cleanEnv();
  const v = readVersion({ name: 'editor' });
  assert.equal(v.name, 'editor');
  assert.equal(v.channel, 'local');
  assert.equal(v.gitCommit, 'unstamped');
  assert.equal(v.gitShortCommit, 'unstamped');
  assert.equal(v.version, '0.0-local');
});

test('reads the stamp file and derives the short commit + name', () => {
  cleanEnv();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpv-rt-'));
  const stampPath = path.join(dir, 'build-stamp.json');
  fs.writeFileSync(stampPath, JSON.stringify({
    version: '1.4.0', channel: 'production', gitCommit: 'abcdef1234567890', builtAt: '2026-06-21T00:00:00Z', name: 'editor',
  }));
  const v = readVersion({ stampPath, name: 'fallback' });
  assert.equal(v.version, '1.4.0');
  assert.equal(v.channel, 'production');
  assert.equal(v.gitShortCommit, 'abcdef1');
  assert.equal(v.name, 'editor'); // stamp.name wins over the passed fallback
});

test('env overrides win over the stamp file', () => {
  cleanEnv();
  process.env.AAA_CHANNEL = 'staging';
  process.env.AAA_GIT_COMMIT = 'feed0001234';
  process.env.AAA_VERSION = '2.0.0';
  const v = readVersion({ name: 'editor' });
  assert.equal(v.channel, 'staging');
  assert.equal(v.version, '2.0.0');
  assert.equal(v.gitShortCommit, 'feed000');
  cleanEnv();
});
