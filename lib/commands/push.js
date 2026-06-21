'use strict';

// push — deploy. Default (or --staging) is `git push`, which staging auto-deploys (PATCH).
// --production ships main to production (next MINOR); add --major for a breaking MAJOR.

const scheme = require('../scheme');
const cli = require('../cli');
const deploy = require('../deploy');
const { hasFlag } = require('../args');

module.exports = function push(args) {
  const staging = hasFlag(args, 'staging');
  const production = hasFlag(args, 'production');
  if (staging && production) cli.fail('push: choose --staging or --production, not both');
  const major = hasFlag(args, 'major');
  if (major && !production) cli.fail('push: --major only applies to --production');
  const dryRun = hasFlag(args, 'dry-run');

  if (!production) {
    deploy.gitPush({ dryRun, intent: 'Pushing committed work to GitHub → STAGING auto-deploys (PATCH)…' });
    return;
  }
  const type = major ? 'major' : 'minor';
  const next = scheme.nextRelease(type);
  deploy.production(['-f', `release_type=${type}`], {
    dryRun,
    intent: `Pushing to PRODUCTION → ${major ? 'BREAKING ' : ''}release ${scheme.format(next)} (${next.tag})…`,
  });
};
