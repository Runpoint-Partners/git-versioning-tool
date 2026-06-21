'use strict';

// Boundary: the only place deploy strategies shell out. Honors dry-run (print the intended
// command, run nothing) so any strategy is previewable before it touches a real environment.

const { execFileSync } = require('child_process');

function run(command, args, { dryRun = false, log = (m) => process.stderr.write(`${m}\n`) } = {}) {
  const line = `${command} ${args.join(' ')}`;
  if (dryRun) { log(`  (dry-run) ${line}`); return; }
  log(`  $ ${line}`);
  execFileSync(command, args, { stdio: 'inherit' });
}

module.exports = { run };
