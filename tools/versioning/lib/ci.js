#!/usr/bin/env node
'use strict';

// INTERNAL deploy engine — invoked ONLY by the production deploy workflow. This is NOT a developer
// command surface; the developer interface is ../index.js (push | rollback | verify). These steps
// implement what `production` / `breaking-change` / `change-version` trigger:
//   resolve-release [minor|major]              -> {version, tag, createTag}
//   rollback <fromVersion> [minor|major|<v>]   -> {version, tag}
//   stamp <file> [--channel=] [--version=]     -> writes the generated certificate

const fs = require('fs');
const path = require('path');
const scheme = require('./scheme');
const { flag, positionals } = require('./args');

const print = (text) => process.stdout.write(`${text}\n`);
const fail = (message, code = 2) => { process.stderr.write(`${message}\n`); process.exit(code); };
const releaseType = (args) => positionals(args).find((arg) => arg === 'minor' || arg === 'major') || 'minor';

const steps = {
  'resolve-release'(args) {
    print(JSON.stringify(scheme.resolveRelease(releaseType(args))));
  },

  rollback(args) {
    const [from, spec] = positionals(args);
    if (!from) fail('rollback: missing <fromVersion>');
    const target = scheme.rollbackTarget(from, spec || 'minor');
    if (target.error) fail(target.error, 1);
    print(JSON.stringify({ version: target.version, tag: target.tag }));
  },

  stamp(args) {
    const file = positionals(args).find((arg) => arg !== 'minor' && arg !== 'major');
    if (!file) fail('stamp: missing <file>');
    const certificate = scheme.buildCertificate({ version: flag(args, 'version'), channel: flag(args, 'channel') });
    fs.writeFileSync(path.resolve(file), `${JSON.stringify(certificate, null, 2)}\n`);
    process.stderr.write(`Stamped ${file}: v${certificate.version} (${certificate.channel}) @ ${certificate.gitShortCommit}\n`);
  },
};

function main() {
  const [step, ...args] = process.argv.slice(2);
  const handler = steps[step];
  if (!handler) fail('internal deploy engine — usage: lib/ci.js resolve-release [minor|major] | rollback <fromVersion> [minor|major|<version>] | stamp <file> [--channel=] [--version=]');
  handler(args);
}

main();
