'use strict';

// Triggers the GitHub deploy workflows (and `git push`) for the push/rollback commands, with a
// --dry-run preview. The only place the toolkit shells out to git/gh to deploy.

const { execFileSync } = require('child_process');
const cli = require('./cli');

const PRODUCTION_WORKFLOW = process.env.DEPLOY_WORKFLOW || 'production.yml';
const STAGING_WORKFLOW = process.env.STAGING_WORKFLOW || 'staging.yml';

function execute(command, args, { dryRun, intent }) {
  cli.print(intent);
  const line = `${command} ${args.join(' ')}`;
  if (dryRun) { cli.print(`  (dry-run) ${line}`); return; }
  try {
    execFileSync(command, args, { stdio: 'inherit' });
  } catch {
    cli.fail(`\nCould not run: ${line}\n${command === 'gh' ? 'Install/auth the GitHub CLI, or run that command yourself (or use the Actions UI).' : ''}`, 1);
  }
}

const gitPush = (opts) => execute('git', ['push'], opts);

const production = (extraArgs, opts) =>
  execute('gh', ['workflow', 'run', PRODUCTION_WORKFLOW, '-f', 'ref=main', ...extraArgs, '-f', 'confirm=production'], opts);

const stagingRollback = (version, opts) =>
  execute('gh', ['workflow', 'run', STAGING_WORKFLOW, '-f', `rollback=${version}`], opts);

module.exports = { gitPush, production, stagingRollback };
