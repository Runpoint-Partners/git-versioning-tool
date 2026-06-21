'use strict';

// Strategy registry. A strategy is the *deploy muscle* — the part that differs per target —
// behind a uniform contract the version core (resolve/stamp/verify) never has to know about:
//
//   { name, validate(cfg) -> string[]  (missing field paths, [] = ok),
//          async deploy(ctx),           ctx = { cfg, channel, dryRun, log }
//          async verify(ctx)?, async rollback(ctx)? }
//
// Built-ins cover the archetypes found across the repos. A repo can bring its own by setting
// deploy.strategy to a relative/absolute path to a module implementing the same contract.

const path = require('path');

const BUILTINS = {
  'server-ssh': require('./server-ssh'),
  'static-s3': require('./static-s3'),
  library: require('./library'),
  custom: require('./custom'),
};

function load(name, { cwd = process.cwd() } = {}) {
  if (!name) throw new Error('no deploy.strategy configured (set a preset or deploy.strategy)');
  if (name.startsWith('.') || path.isAbsolute(name)) {
    return require(path.resolve(cwd, name)); // bring-your-own strategy module
  }
  if (!BUILTINS[name]) {
    throw new Error(`unknown deploy.strategy "${name}" — built-ins: ${names().join(', ')} (or a path to your own)`);
  }
  return BUILTINS[name];
}

function names() { return Object.keys(BUILTINS); }

module.exports = { load, names };
