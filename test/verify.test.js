'use strict';

// verify command — environment required (--staging/--production); URL via --url= or env/config.
// Ported from the editor's versioning-verify.test.js. Uses a version with no release tag for the
// "tag missing" case (this repo's own v1.0.0 tag exists, so a real-ish version would resolve).

const { test } = require('node:test');
const assert = require('node:assert');
const { execFile } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const CLI = path.resolve(__dirname, '..', 'index.js');

function run(args) {
  const env = { ...process.env };
  delete env.STAGING_URL;
  delete env.PRODUCTION_URL;
  return new Promise((resolve) => {
    execFile('node', [CLI, 'verify', ...args], { encoding: 'utf8', env }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: `${stdout || ''}${stderr || ''}` });
    });
  });
}

function withServer(payload, fn) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/version') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); }
      else { res.writeHead(404); res.end(); }
    });
    server.listen(0, '127.0.0.1', async () => {
      const url = `http://127.0.0.1:${server.address().port}`;
      try { await fn(url); resolve(); } catch (e) { reject(e); } finally { server.close(); }
    });
  });
}

test('requires an environment flag (exit 2)', async () => {
  assert.strictEqual((await run([])).code, 2);
});

test('rejects both --staging and --production (exit 2)', async () => {
  assert.strictEqual((await run(['--staging', '--production'])).code, 2);
});

test('errors when no URL is configured for the chosen env (exit 2)', async () => {
  const r = await run(['--staging', '--no-fetch']);
  assert.strictEqual(r.code, 2);
  assert.match(r.out, /STAGING_URL|--url|channels\.staging\.url/);
});

test('unstamped environment → unverifiable (exit 3)', async () => {
  await withServer({ version: '1.0.0', channel: 'local', gitCommit: 'unstamped' }, async (url) => {
    const r = await run(['--staging', `--url=${url}`, '--no-fetch']);
    assert.strictEqual(r.code, 3);
    assert.match(r.out, /unstamped/i);
  });
});

test('stamped but version tag missing in git → inconsistent (exit 1)', async () => {
  await withServer({ version: '99.0.0', channel: 'production', gitCommit: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }, async (url) => {
    const r = await run(['--production', `--url=${url}`, '--no-fetch']);
    assert.strictEqual(r.code, 1);
    assert.match(r.out, /not found in git|MISMATCH/);
  });
});

test('positional <version> compares against that version (mismatch → exit 1)', async () => {
  await withServer({ version: '99.0.0', channel: 'production', gitCommit: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }, async (url) => {
    const r = await run(['--production', `--url=${url}`, '9.9.9', '--no-fetch']);
    assert.strictEqual(r.code, 1);
    assert.match(r.out, /Compared to : v9\.9\.9/);
  });
});
