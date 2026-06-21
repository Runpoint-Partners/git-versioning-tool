'use strict';

// rollback-target — compute the release to roll back to, relative to the live version. Pure
// version math; prints JSON {version, tag} (exit 1 if no such release). Used by the workflow's
// rollback path. (The developer-facing `rpv rollback` triggers the workflow; this computes it.)
//   rpv rollback-target <fromVersion> [minor|major|<version>]

const scheme = require('../scheme');
const cli = require('../cli');
const { positionals } = require('../args');

module.exports = function rollbackTarget(args) {
  const [from, spec] = positionals(args);
  if (!from) cli.fail('rollback-target: missing <fromVersion>');
  const target = scheme.rollbackTarget(from, spec || 'minor');
  if (target.error) cli.fail(target.error, 1);
  cli.print(JSON.stringify({ version: target.version, tag: target.tag }));
};
