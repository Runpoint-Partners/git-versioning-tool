'use strict';

// resolve-release — compute the next release (or the one at HEAD, for re-deploy). Pure version
// math over git tags; prints JSON {version, tag, createTag} for the workflow to consume.
//   rpv resolve-release [--release=minor|major]

const scheme = require('../scheme');
const cli = require('../cli');
const { flag } = require('../args');

module.exports = function resolveRelease(args) {
  const type = flag(args, 'release') || 'minor';
  if (type !== 'minor' && type !== 'major') cli.fail('resolve-release: --release must be "minor" or "major"');
  cli.print(JSON.stringify(scheme.resolveRelease(type)));
};
