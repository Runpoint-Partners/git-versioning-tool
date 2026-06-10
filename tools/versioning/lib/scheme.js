'use strict';

// The versioning scheme (reset-on-release) — pure domain logic over the git gateway.
// MAJOR = highest release-tag major (default 1); bumped only by a breaking-change deploy.
// MINOR = production-release ordinal (one vMAJOR.MINOR.0 tag per production deploy).
// PATCH = commits since the last release tag. The commit SHA is the identity of record.

const git = require('./git');

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function format(version) { return `${version.major}.${version.minor}.${version.patch}`; }

function highestMajor(tags) {
  return tags.length ? Math.max(...tags.map((tag) => tag.major)) : null;
}

function currentMajor() {
  const major = highestMajor(git.releaseTags());
  return major == null ? 1 : major;
}

function currentVersion(at = 'HEAD') {
  const major = currentMajor();
  const tags = git.releaseTags();
  const onMajor = tags.filter((tag) => tag.major === major);
  if (onMajor.length) {
    const { minor } = onMajor[onMajor.length - 1];
    return { major, minor, patch: git.commitCount(`v${major}.${minor}.0..${at}`) };
  }
  // No release on the current major yet: minor 0, count since the previous major's last release.
  const lower = tags.filter((tag) => tag.major < major);
  const base = lower.length ? lower[lower.length - 1].tag : null;
  return { major, minor: 0, patch: base ? git.commitCount(`${base}..${at}`) : git.commitCount(at) };
}

function nextRelease(type = 'minor') {
  const tags = git.releaseTags();
  const maxMajor = highestMajor(tags);
  if (type === 'major') {
    const major = maxMajor == null ? 1 : maxMajor + 1;
    return { major, minor: 0, patch: 0, tag: `v${major}.0.0` };
  }
  const major = maxMajor == null ? 1 : maxMajor;
  const minors = tags.filter((tag) => tag.major === major).map((tag) => tag.minor);
  const minor = minors.length ? Math.max(...minors) + 1 : 0;
  return { major, minor, patch: 0, tag: `v${major}.${minor}.0` };
}

// Re-deploy the release at HEAD (rollback), or cut the next one.
function resolveRelease(type = 'minor') {
  const existing = git.releaseTagAtHead();
  if (existing) return { version: existing.slice(1), tag: existing, createTag: false };
  const next = nextRelease(type);
  return { version: format(next), tag: next.tag, createTag: true };
}

// The release to roll back to, relative to the live version `from`:
// minor = one release back, major = previous major's latest, or an explicit version.
function rollbackTarget(from, spec = 'minor') {
  const origin = String(from).match(SEMVER);
  if (!origin) return { error: `current version "${from}" is not MAJOR.MINOR.PATCH` };
  const fromMajor = Number(origin[1]);
  const fromMinor = Number(origin[2]);
  const tags = git.releaseTags();

  const explicit = String(spec).match(/^(\d+)\.(\d+)(?:\.\d+)?$/);
  if (explicit) {
    const tag = `v${explicit[1]}.${explicit[2]}.0`;
    return tags.some((t) => t.tag === tag)
      ? { version: `${explicit[1]}.${explicit[2]}.0`, tag }
      : { error: `release ${tag} not found` };
  }

  const olderThanFrom = {
    major: (tag) => tag.major < fromMajor,
    minor: (tag) => tag.major < fromMajor || (tag.major === fromMajor && tag.minor < fromMinor),
  }[spec];
  if (!olderThanFrom) return { error: `unknown rollback "${spec}" — use minor | major | a version like 1.3.0` };

  const candidates = tags.filter(olderThanFrom);
  const target = candidates[candidates.length - 1];
  return target
    ? { version: `${target.major}.${target.minor}.0`, tag: target.tag }
    : { error: `no earlier ${spec} release than ${from}` };
}

// The certificate: version + commit SHA co-located. Generated, never committed.
function buildCertificate({ version, channel } = {}) {
  const sha = git.headSha() || 'unknown';
  return {
    version: version || format(currentVersion()),
    channel: channel || process.env.AAA_CHANNEL || 'local',
    gitCommit: sha,
    gitShortCommit: sha === 'unknown' ? 'unknown' : sha.slice(0, 7),
    builtAt: new Date().toISOString(),
  };
}

module.exports = {
  format, currentMajor, currentVersion, nextRelease, resolveRelease, rollbackTarget, buildCertificate,
};
