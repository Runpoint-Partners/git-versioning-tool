'use strict';

// Boundary: the only module that shells out to the `git` CLI. Everything else depends on this
// gateway, not on git directly. A failed git call returns null (read) / false (predicate) rather
// than throwing, so callers stay branch-simple.

const { execFileSync } = require('child_process');

function read(args) {
  try { return execFileSync('git', args, { encoding: 'utf8' }).trim(); }
  catch { return null; }
}

function succeeds(args) {
  try { execFileSync('git', args, { stdio: 'ignore' }); return true; }
  catch { return false; }
}

function revParse(ref) { return read(['rev-parse', ref]); }

function headSha(ref = 'HEAD') { return revParse(ref); }

function commitExists(ref) { return succeeds(['cat-file', '-e', `${ref}^{commit}`]); }

function isAncestor(ancestor, descendant) {
  return succeeds(['merge-base', '--is-ancestor', ancestor, descendant]);
}

function commitCount(range = 'HEAD') {
  const out = read(['rev-list', '--count', range]);
  return out == null ? 0 : Number(out);
}

// Release tags vX.Y.0 -> [{ major, minor, tag }], ascending by (major, minor).
function releaseTags() {
  const out = read(['tag', '--list', 'v*.*.0']);
  if (!out) return [];
  return out.split('\n')
    .map((line) => line.trim().match(/^v(\d+)\.(\d+)\.0$/))
    .filter(Boolean)
    .map((m) => ({ major: Number(m[1]), minor: Number(m[2]), tag: `v${m[1]}.${m[2]}.0` }))
    .sort((a, b) => a.major - b.major || a.minor - b.minor);
}

// The release tag (vX.Y.0) HEAD currently sits on, or null.
function releaseTagAtHead() {
  const out = read(['tag', '--points-at', 'HEAD', '--list', 'v*.*.0']) || '';
  return out.split('\n').map((line) => line.trim()).find((tag) => /^v\d+\.\d+\.0$/.test(tag)) || null;
}

// The commit a release tag points at (annotated or lightweight), or null if the tag is unknown.
function tagCommit(tag) { return read(['rev-parse', '-q', '--verify', `refs/tags/${tag}^{commit}`]); }

function fetchTags(remote = 'origin') { read(['fetch', '--tags', '--quiet', remote]); }

module.exports = {
  revParse, headSha, commitExists, isAncestor, commitCount,
  releaseTags, releaseTagAtHead, tagCommit, fetchTags,
};
