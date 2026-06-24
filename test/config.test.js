'use strict';

// Config subsystem: precedence (preset < project < env), $ENV resolution + missing-ref
// reporting, monorepo package selection, discovery order, and dotted get().

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const config = require('../lib/config');

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpv-cfg-'));
  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), typeof contents === 'string' ? contents : JSON.stringify(contents));
  }
  return dir;
}
const pkg = (versioning) => ({ name: 'fixture', version: '1.0.0', versioning });

test('resolves from the package.json "versioning" key', () => {
  const cwd = fixture({ 'package.json': pkg({ appName: 'editor', preset: 'library' }) });
  const c = config.resolve({ cwd });
  assert.equal(c.appName, 'editor');
  assert.equal(c._meta.source, 'package.json#versioning');
  assert.equal(c._meta.preset, 'library');
});

test('preset defaults are overridden by project config (preset < project)', () => {
  const cwd = fixture({ 'package.json': pkg({
    appName: 'editor', preset: 'server-ssh',
    deploy: { host: 'box.example', appRoot: '/srv/app' }, // overrides + adds onto the preset
  }) });
  const c = config.resolve({ cwd });
  assert.equal(c.deploy.strategy, 'server-ssh');   // from preset
  assert.equal(c.deploy.user, 'ec2-user');         // from preset default
  assert.equal(c.deploy.host, 'box.example');      // from project
  assert.equal(c.deploy.appRoot, '/srv/app');      // from project
});

test('$ENV references resolve from env; missing ones are recorded, not thrown', () => {
  const cwd = fixture({ 'package.json': pkg({
    appName: 'a', preset: 'server-ssh',
    deploy: { host: '$DEPLOY_HOST', sshKey: '$MISSING_KEY' },
  }) });
  const c = config.resolve({ cwd, env: { DEPLOY_HOST: 'h.example' } });
  assert.equal(c.deploy.host, 'h.example');
  assert.equal(c.deploy.sshKey, null);
  const refs = Object.fromEntries(c._meta.envRefs.map((r) => [r.ref, r.set]));
  assert.equal(refs.DEPLOY_HOST, true);
  assert.equal(refs.MISSING_KEY, false);
});

test('channel selection exposes channelConfig for the requested channel', () => {
  const cwd = fixture({ 'package.json': pkg({
    appName: 'a', preset: 'server-ssh',
    channels: { production: { url: 'https://prod.example', stampPath: 'src/build-stamp.json' } },
  }) });
  const c = config.resolve({ cwd, channel: 'production' });
  assert.equal(c.channelName, 'production');
  assert.equal(c.channelConfig.url, 'https://prod.example');
  assert.equal(c.channelConfig.stampPath, 'src/build-stamp.json');
});

test('channels.<channel>.deploy merges over the base deploy (per-channel host for a separate box)', () => {
  const cwd = fixture({ 'package.json': pkg({
    appName: 'a', preset: 'server-ssh',
    deploy: { host: '$DEPLOY_HOST', appRoot: '/srv/app' },
    channels: {
      production: { url: 'https://prod.example', stampPath: 's' },
      staging: { url: 'http://stage.example', stampPath: 's', deploy: { host: '$STAGING_DEPLOY_HOST' } },
    },
  }) });
  const env = { DEPLOY_HOST: 'prod.box', STAGING_DEPLOY_HOST: 'stage.box' };

  // production has no per-channel deploy → base host is used, untouched.
  const prod = config.resolve({ cwd, channel: 'production', env });
  assert.equal(prod.deploy.host, 'prod.box');
  assert.equal(prod.deploy.appRoot, '/srv/app');

  // staging's channel deploy override wins for host; the base appRoot is preserved (merge, not replace).
  const stage = config.resolve({ cwd, channel: 'staging', env });
  assert.equal(stage.deploy.host, 'stage.box');
  assert.equal(stage.deploy.appRoot, '/srv/app');

  // no channel selected → base deploy is unchanged (backward compatible).
  const none = config.resolve({ cwd, env });
  assert.equal(none.deploy.host, 'prod.box');
});

test('monorepo: requires --package, rejects unknown, merges shared < package', () => {
  const cwd = fixture({ 'versioning.config.js':
    `module.exports = ${JSON.stringify({
      versionMode: 'independent',
      appName: 'shared-default',
      packages: [
        { name: 'editor', path: 'packages/editor', preset: 'static-s3', deploy: { bucket: 'b1', artifactDir: 'd' } },
      ],
    })}` });

  assert.throws(() => config.resolve({ cwd }), /multi-package/);
  assert.throws(() => config.resolve({ cwd, packageName: 'nope' }), /unknown package/);

  const c = config.resolve({ cwd, packageName: 'editor' });
  assert.equal(c.versionMode, 'independent');     // shared root key
  assert.equal(c.deploy.bucket, 'b1');            // package override
  assert.equal(c._meta.package.name, 'editor');
  assert.equal(c._meta.package.path, 'packages/editor');
});

test('versioning.config.js wins over package.json#versioning', () => {
  const cwd = fixture({
    'package.json': pkg({ appName: 'from-pkg', preset: 'library' }),
    'versioning.config.js': `module.exports = { appName: 'from-js', preset: 'library' };`,
  });
  assert.equal(config.resolve({ cwd }).appName, 'from-js');
});

test('no config found throws NO_CONFIG', () => {
  const cwd = fixture({ 'package.json': { name: 'x', version: '1.0.0' } });
  assert.throws(() => config.resolve({ cwd }), (e) => e.code === 'NO_CONFIG');
});

test('get() reads a dotted path', () => {
  const cwd = fixture({ 'package.json': pkg({ appName: 'a', preset: 'server-ssh', deploy: { host: 'h' } }) });
  const c = config.resolve({ cwd });
  assert.equal(config.get(c, 'deploy.strategy'), 'server-ssh');
  assert.equal(config.get(c, 'deploy.host'), 'h');
  assert.equal(config.get(c, 'deploy.nope.deep'), undefined);
});

test('unknown preset throws loudly', () => {
  const cwd = fixture({ 'package.json': pkg({ appName: 'a', preset: 'nonsense' }) });
  assert.throws(() => config.resolve({ cwd }), /unknown preset/);
});
