'use strict';

// stamp — write the generated provenance certificate to the channel's configured stampPath.
// The certificate co-locates version + commit SHA (a commit can't store its own SHA, which is
// what makes /version tamper-evident). Used by the reusable workflow after resolve-release.
//   rpv stamp --channel=production [--version=X] [--package=] [--out=override]

const fs = require('fs');
const path = require('path');
const scheme = require('../scheme');
const config = require('../config');
const cli = require('../cli');
const { flag } = require('../args');

module.exports = function stamp(args) {
  const channel = flag(args, 'channel');
  if (!channel) cli.fail('stamp: --channel=<name> is required');
  const packageName = flag(args, 'package');

  let resolved;
  try {
    resolved = config.resolve({ channel, packageName });
  } catch (err) {
    cli.fail(`stamp: ${err.message}`);
  }

  const stampPath = flag(args, 'out') || (resolved.channelConfig && resolved.channelConfig.stampPath);
  if (!stampPath) cli.fail(`stamp: no stampPath for channel "${channel}" — set channels.${channel}.stampPath or pass --out=`);

  const certificate = scheme.buildCertificate({ version: flag(args, 'version'), channel, name: resolved.appName });
  fs.writeFileSync(path.resolve(stampPath), `${JSON.stringify(certificate, null, 2)}\n`);
  process.stderr.write(`Stamped ${stampPath}: v${certificate.version} (${certificate.channel}) @ ${certificate.gitShortCommit}\n`);
};
