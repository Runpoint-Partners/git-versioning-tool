'use strict';

// rollback — re-deploy an existing release. Environment is required (--staging | --production).
// Staging rollback is temporary: the next push restores latest main.

const cli = require('../cli');
const deploy = require('../deploy');
const { hasFlag, positionals } = require('../args');

module.exports = function rollback(args) {
  const version = positionals(args)[0];
  if (!version) cli.fail('rollback: missing <version> (e.g. 1.3.0)');
  const env = cli.requireEnv(args, 'rollback');
  const dryRun = hasFlag(args, 'dry-run');

  if (env === 'production') {
    deploy.production(['-f', `rollback=${version}`], { dryRun, intent: `Rolling PRODUCTION back to version ${version}…` });
  } else {
    deploy.stagingRollback(version, { dryRun, intent: `Rolling STAGING back to version ${version} (temporary — the next push restores latest)…` });
  }
};
