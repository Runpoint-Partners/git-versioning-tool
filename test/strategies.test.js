'use strict';

// Strategy registry + built-in contracts: load/unknown/bring-your-own, validate() field
// reporting, and that deploy() in dry-run emits the right commands without executing.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const strategies = require('../lib/strategies');
const { validate } = require('../lib/validate');

test('registry loads built-ins and rejects unknown names', () => {
  assert.equal(strategies.load('server-ssh').name, 'server-ssh');
  assert.equal(strategies.load('static-s3').name, 'static-s3');
  assert.equal(strategies.load('library').name, 'library');
  assert.equal(strategies.load('custom').name, 'custom');
  assert.throws(() => strategies.load('nope'), /unknown deploy.strategy/);
  assert.throws(() => strategies.load(null), /no deploy.strategy/);
});

test('server-ssh.validate reports each missing field, [] when complete', () => {
  const s = strategies.load('server-ssh');
  assert.deepEqual(
    s.validate({ deploy: {} }).sort(),
    ['deploy.appRoot', 'deploy.host', 'deploy.processes[]', 'deploy.sshKey (path to the private key the CI step writes)'].sort()
  );
  assert.deepEqual(
    s.validate({ deploy: { host: 'h', appRoot: '/a', sshKey: '/k', processes: [{ name: 'app' }] } }),
    []
  );
});

test('static-s3 + custom + library validate', () => {
  assert.deepEqual(strategies.load('static-s3').validate({ deploy: { bucket: 'b' } }), ['deploy.artifactDir (local directory to upload)']);
  assert.deepEqual(strategies.load('static-s3').validate({ deploy: { bucket: 'b', artifactDir: 'd' } }), []);
  assert.deepEqual(strategies.load('custom').validate({ deploy: {} }), ['deploy.command']);
  assert.deepEqual(strategies.load('custom').validate({ deploy: { command: 'x' } }), []);
  assert.deepEqual(strategies.load('library').validate({}), []);
});

test('server-ssh.deploy (dry-run) emits rsync + ssh/pm2 without executing', async () => {
  const lines = [];
  await strategies.load('server-ssh').deploy({
    cfg: { appName: 'myapp', deploy: {
      host: 'box', user: 'ec2-user', appRoot: '/srv/myapp', sshKey: '/tmp/key',
      processes: [{ name: 'myapp', script: 'index.js' }],
    } },
    dryRun: true, log: (m) => lines.push(m),
  });
  const out = lines.join('\n');
  assert.match(out, /\(dry-run\) rsync .*--delete.*ec2-user@box:\/srv\/myapp\//);
  assert.match(out, /pm2 start index\.js --name 'myapp'/);
  assert.match(out, /npm ci --omit=dev/);
});

test('server-ssh.deploy runs preRemote box steps after rsync, before npm ci', async () => {
  const lines = [];
  await strategies.load('server-ssh').deploy({
    cfg: { appName: 'myapp', deploy: {
      host: 'box', appRoot: '/srv/myapp', sshKey: '/tmp/key',
      processes: [{ name: 'myapp', script: 'index.js' }],
      preRemote: ['test -f .env || cp /opt/shared/.env .env', 'bash scripts/deploy/prep.sh'],
    } },
    dryRun: true, log: (m) => lines.push(m),
  });
  const ssh = lines.find((l) => l.includes('cp /opt/shared/.env'));
  assert.ok(ssh, 'preRemote commands should appear in the ssh chain');
  assert.ok(ssh.indexOf('prep.sh') < ssh.indexOf('npm ci'), 'preRemote runs before npm ci');
});

test('static-s3.deploy (dry-run) emits aws s3 sync to the prefixed bucket', async () => {
  const lines = [];
  await strategies.load('static-s3').deploy({
    cfg: { appName: 'myapp', deploy: { bucket: 'example-bucket', prefix: '/app/v1/', artifactDir: 'dist', cacheControl: 'no-cache' } },
    dryRun: true, log: (m) => lines.push(m),
  });
  assert.match(lines.join('\n'), /\(dry-run\) aws s3 sync dist s3:\/\/example-bucket\/app\/v1\/ --delete --cache-control no-cache/);
});

test('validate() composes appName + strategy field checks + missing env', () => {
  const report = validate({
    appName: 'myapp',
    deploy: { strategy: 'server-ssh', host: 'h', appRoot: '/a' }, // missing sshKey + processes
    _meta: { envRefs: [{ ref: 'A', set: true }, { ref: 'B', set: false }] },
  });
  assert.equal(report.strategy, 'server-ssh');
  assert.deepEqual(report.missingEnv, ['B']);
  assert.ok(report.errors.some((e) => /sshKey/.test(e)));
  assert.ok(report.errors.some((e) => /processes/.test(e)));

  const missingName = validate({ deploy: { strategy: 'library' }, _meta: { envRefs: [] } });
  assert.ok(missingName.errors.includes('appName is required'));
});
