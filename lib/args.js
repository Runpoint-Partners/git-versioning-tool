'use strict';

// Tiny argv helpers shared by the CLIs. `--name=value` flags and bare positionals.

function flag(args, name) {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function hasFlag(args, name) { return args.includes(`--${name}`); }

function positionals(args) { return args.filter((arg) => !arg.startsWith('--')); }

module.exports = { flag, hasFlag, positionals };
