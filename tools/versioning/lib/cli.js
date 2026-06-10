'use strict';

// CLI output + shared arg helpers used by every command.

const { hasFlag } = require('./args');

const print = (text) => process.stdout.write(`${text}\n`);
const fail = (message, code = 2) => { process.stderr.write(`${message}\n`); process.exit(code); };

// Exactly one of --staging / --production. Returns 'staging' | 'production', else fails (exit 2).
function requireEnv(args, verb) {
  const staging = hasFlag(args, 'staging');
  const production = hasFlag(args, 'production');
  if (staging === production) fail(`${verb}: choose exactly one environment — --staging or --production`);
  return production ? 'production' : 'staging';
}

module.exports = { print, fail, requireEnv };
