'use strict';

// Verification domain: turn a live environment's certificate into a structured verdict by
// cross-checking it against git. Pure — no HTTP, no printing, no process.exit. The verdict
// carries everything the presenter needs, plus an exit code.

const git = require('./git');
const scheme = require('./scheme');

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const RESULT = { VERIFIED: 'verified', INCONSISTENT: 'inconsistent', UNVERIFIABLE: 'unverifiable' };
const EXIT = { verified: 0, inconsistent: 1, unverifiable: 3 };

const short = (sha) => (sha ? String(sha).slice(0, 7) : '?');

function isStamped(certificate) {
  return Boolean(certificate.channel && certificate.channel !== 'local'
    && certificate.gitCommit && certificate.gitCommit !== 'unstamped');
}

// Does the reported version genuinely correspond to the reported commit, per the release tags?
// ok: true = consistent, false = tamper/mismatch, null = can't tell (commit not fetched locally).
function versionMatchesCommit(version, commit) {
  const parsed = String(version).match(SEMVER);
  if (!parsed) return { ok: false, note: `version "${version}" is not MAJOR.MINOR.PATCH` };
  const [major, minor, patch] = parsed.slice(1).map(Number);
  const tag = `v${major}.${minor}.0`;
  const tagCommit = git.tagCommit(tag);
  if (!tagCommit) return { ok: false, note: `release tag ${tag} not found in git — version claim unverifiable (was it deployed/pushed?)` };
  if (!git.commitExists(commit)) return { ok: null, note: `running commit ${short(commit)} not in local clone — run "git fetch"` };

  if (patch === 0) {
    return tagCommit === git.revParse(commit)
      ? { ok: true, note: `release ${tag} -> ${short(tagCommit)} matches the running commit` }
      : { ok: false, note: `MISMATCH: GitHub tag ${tag} -> ${short(tagCommit)} but running ${short(commit)} (tamper or misdeploy)` };
  }
  if (!git.isAncestor(tag, commit)) return { ok: false, note: `MISMATCH: ${tag} is not an ancestor of running ${short(commit)}` };
  const distance = git.commitCount(`${tag}..${commit}`);
  return distance === patch
    ? { ok: true, note: `${major}.${minor}.${patch} = ${tag} + ${patch} commit(s), consistent with the running commit` }
    : { ok: false, note: `MISMATCH: claims patch ${patch} but running commit is ${distance} commit(s) past ${tag}` };
}

function freshness(commit, ref) {
  const refSha = git.revParse(ref);
  if (!refSha) return { state: 'noref', text: `ref ${ref} not found locally` };
  if (!git.commitExists(commit)) return { state: 'unknown', text: `running commit not in local clone — run "git fetch"` };
  if (git.revParse(commit) === refSha) return { state: 'equal', text: `up to date with ${ref}` };
  if (git.isAncestor(commit, ref)) return { state: 'behind', text: `BEHIND ${ref} by ${git.commitCount(`${commit}..${ref}`)} commit(s) — a change not yet deployed?` };
  if (git.isAncestor(ref, commit)) return { state: 'ahead', text: `AHEAD of ${ref} by ${git.commitCount(`${ref}..${commit}`)} commit(s)` };
  return { state: 'diverged', text: `diverged from ${ref}` };
}

function unverifiable(base, detail) {
  return { ...base, result: RESULT.UNVERIFIABLE, exitCode: EXIT.unverifiable, detail };
}

function evaluate(certificate, { environment, target = null, ref = 'origin/main' } = {}) {
  const base = {
    environment,
    reportedVersion: certificate.version,
    reportedCommit: certificate.gitCommit,
    channel: certificate.channel,
    builtAt: certificate.builtAt,
    stamped: isStamped(certificate),
  };
  if (!base.stamped) {
    return unverifiable(base, 'environment is unstamped (channel=local / commit=unstamped) — it predates the provenance deploy; deploy to production to enable verification.');
  }

  const versionCommit = versionMatchesCommit(certificate.version, certificate.gitCommit);
  let result = versionCommit.ok === false ? RESULT.INCONSISTENT
    : versionCommit.ok === null ? RESULT.UNVERIFIABLE
      : RESULT.VERIFIED;

  const verdict = { ...base, versionCommit };
  if (target) {
    verdict.mode = 'expect';
    verdict.target = target;
    verdict.match = certificate.version === target;
    if (!verdict.match) result = RESULT.INCONSISTENT;
  } else {
    verdict.mode = 'latest';
    verdict.latestRef = ref;
    verdict.latestVersion = scheme.format(scheme.currentVersion(ref));
    verdict.freshness = freshness(certificate.gitCommit, ref);
    if (verdict.freshness.state !== 'equal' && result !== RESULT.UNVERIFIABLE) result = RESULT.INCONSISTENT;
  }

  verdict.result = result;
  verdict.exitCode = EXIT[result];
  return verdict;
}

module.exports = { evaluate };
