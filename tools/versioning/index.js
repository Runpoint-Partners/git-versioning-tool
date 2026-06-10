#!/usr/bin/env node
'use strict';

// Unified CLI for the versioning toolkit — three commands. See ./README.md.
//   push      [--staging (default) | --production [--major]]   deploy
//   rollback  <version> (--staging | --production)             re-deploy an existing release
//   verify    (--staging | --production) [version]             is a live env on the version it claims?
//
// Add --dry-run to preview. Everything else lives in ./lib (commands + domain + boundaries);
// the deploy workflows are in ./templates. Run as `node tools/versioning <command>`.

const cli = require('./lib/cli');

const commands = {
  push: require('./lib/commands/push'),
  rollback: require('./lib/commands/rollback'),
  verify: require('./lib/commands/verify'),
};

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const handler = commands[command];
  if (!handler) {
    cli.fail('usage: push [--production [--major] | --staging] | rollback <version> (--production | --staging) | verify (--production | --staging) [version]   [--dry-run]');
  }
  await handler(args);
}

main();
