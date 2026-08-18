'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const git = require('../lib/git');

test('staging version is based on the newest release reachable from its commit', () => {
  const originals = {
    releaseTags: git.releaseTags,
    isAncestor: git.isAncestor,
    commitCount: git.commitCount,
  };
  git.releaseTags = () => [
    { major: 1, minor: 74, tag: 'v1.74.0' },
    { major: 1, minor: 76, tag: 'v1.76.0' },
  ];
  git.isAncestor = (tag) => tag === 'v1.74.0';
  git.commitCount = (range) => {
    assert.equal(range, 'v1.74.0..candidate');
    return 37;
  };

  delete require.cache[require.resolve('../lib/scheme')];
  const scheme = require('../lib/scheme');
  assert.deepEqual(scheme.currentVersion('candidate'), { major: 1, minor: 74, patch: 37 });

  git.releaseTags = originals.releaseTags;
  git.isAncestor = originals.isAncestor;
  git.commitCount = originals.commitCount;
  delete require.cache[require.resolve('../lib/scheme')];
});
