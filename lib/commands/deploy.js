'use strict';

// deploy — run the configured deploy strategy for a channel. Used INSIDE the reusable workflow
// (after the tag is cut + the build-stamp is written); not a routine local command. Validates
// config first and fails loudly with the missing fields before touching the environment.
//   rpv deploy --channel=production [--package=] [--dry-run]

const config = require('../config');
const strategies = require('../strategies');
const { validate } = require('../validate');
const cli = require('../cli');
const { flag, hasFlag } = require('../args');

module.exports = async function deployCmd(args) {
  const channel = flag(args, 'channel')
    || (hasFlag(args, 'production') ? 'production' : hasFlag(args, 'staging') ? 'staging' : null);
  if (!channel) cli.fail('deploy: choose a channel — --channel=<name> | --production | --staging');
  const packageName = flag(args, 'package');
  const dryRun = hasFlag(args, 'dry-run');

  let resolved;
  try {
    resolved = config.resolve({ channel, packageName });
  } catch (err) {
    cli.fail(`deploy: ${err.message}`);
  }

  const { errors } = validate(resolved);
  if (errors.length) cli.fail(`deploy: config invalid —\n  ${errors.join('\n  ')}`, 1);

  const strategy = strategies.load(resolved.deploy.strategy);
  cli.print(`Deploying ${resolved.appName} -> ${channel} via "${strategy.name}"${dryRun ? ' (dry-run)' : ''}…`);
  await strategy.deploy({ cfg: resolved, channel, dryRun, log: (m) => process.stderr.write(`${m}\n`) });
  cli.print('Deploy step complete.');
};
