#!/usr/bin/env node
'use strict';

// rpv — the versioning + deploy toolkit CLI. Two surfaces:
//
//   Developer (local):
//     init      --preset <name>                      scaffold a "versioning" config block
//     config    print | get <dotpath>                inspect the resolved config + validation
//     push      [--staging | --production [--major]]  trigger a deploy (via the GitHub workflow)
//     rollback  <version> (--staging | --production)  re-deploy an existing release
//     verify    (--staging | --production) [version]  is a live env on the version it claims?
//
//   Workflow (CI — invoked by the reusable workflow):
//     resolve-release  [--release=minor|major]        -> {version, tag, createTag}
//     rollback-target  <fromVersion> [spec]           -> {version, tag}
//     stamp     --channel=<c> [--version=]             write the provenance certificate
//     deploy    --channel=<c> [--package=]            run the configured deploy strategy
//
// Add --dry-run to preview deploys. Everything else lives in ./lib.

const cli = require('./lib/cli');

const commands = {
  init: require('./lib/commands/init'),
  config: require('./lib/commands/config'),
  push: require('./lib/commands/push'),
  rollback: require('./lib/commands/rollback'),
  verify: require('./lib/commands/verify'),
  deploy: require('./lib/commands/deploy'),
  'resolve-release': require('./lib/commands/resolve-release'),
  'rollback-target': require('./lib/commands/rollback-target'),
  stamp: require('./lib/commands/stamp'),
};

const USAGE = `usage: rpv <command> [options]
  developer: init --preset <name> | config (print|get <dotpath>) |
             push [--staging|--production [--major]] | rollback <version> (--staging|--production) |
             verify (--staging|--production) [version]
  workflow:  resolve-release [--release=minor|major] | rollback-target <from> [spec] |
             stamp --channel=<c> [--version=] | deploy --channel=<c> [--package=]
  (add --dry-run to preview a deploy)`;

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const handler = commands[command];
  if (!handler) cli.fail(USAGE);
  await handler(args);
}

main();
