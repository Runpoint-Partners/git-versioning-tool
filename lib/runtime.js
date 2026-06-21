'use strict';

// Runtime provenance reader for a consuming app's `GET /version` handler. This is the ONLY
// part of the toolkit a *running* app imports — kept tiny and dependency-direction-clean so a
// production server never pulls in the deploy CLI. Reads the deploy-stamped certificate,
// falling back to honest sentinels (never silent fake data).
//
//   const { readVersion } = require('@runpoint-partners/versioning/runtime');
//   app.get('/version', (_req, res) => res.json(readVersion({
//     name: 'editor', stampPath: path.join(__dirname, 'build-stamp.json'), packageJson: '../package.json',
//   })));

const fs = require('fs');
const path = require('path');

function readVersion({ stampPath = null, name = 'app', packageJson = null } = {}) {
  let stamp = {
    version: process.env.AAA_VERSION || undefined,
    channel: process.env.AAA_CHANNEL || 'local',
    gitCommit: process.env.AAA_GIT_COMMIT || 'unstamped',
    builtAt: process.env.AAA_BUILT_AT || 'unstamped',
  };
  // Env wins (the deploy exports it); otherwise read the stamp file beside the app.
  if (stamp.channel === 'local' && stamp.gitCommit === 'unstamped' && stampPath) {
    try { stamp = { ...stamp, ...JSON.parse(fs.readFileSync(path.resolve(stampPath), 'utf8')) }; }
    catch { /* unstamped — fall through to sentinels */ }
  }

  let version = '0.0-local';
  if (packageJson) {
    try { version = require(path.resolve(packageJson)).version || version; } catch { /* keep default */ }
  }
  if (stamp.version) version = stamp.version;

  const gitShortCommit = stamp.gitCommit === 'unstamped' ? 'unstamped' : String(stamp.gitCommit).slice(0, 7);
  return {
    name: stamp.name || name,
    version,
    channel: stamp.channel,
    gitCommit: stamp.gitCommit,
    gitShortCommit,
    builtAt: stamp.builtAt,
    uptime: process.uptime(),
  };
}

module.exports = { readVersion };
