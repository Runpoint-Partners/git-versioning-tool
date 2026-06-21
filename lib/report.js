'use strict';

// Presentation: render a verifier verdict as human-readable text or JSON. No logic here.

const short = (sha) => (sha ? String(sha).slice(0, 7) : '?');

function comparisonLines(verdict) {
  if (verdict.mode === 'expect') {
    const outcome = verdict.match ? 'OK matches' : `FAIL production reports v${verdict.reportedVersion}`;
    return [`Compared to : v${verdict.target} (requested) -> ${outcome}`];
  }
  return [
    `Latest in git: v${verdict.latestVersion} @ ${verdict.latestRef}`,
    `Compared    : ${verdict.freshness.text}`,
  ];
}

function renderText(verdict) {
  const header = [
    `Environment : ${verdict.environment}`,
    `Production  : v${verdict.reportedVersion ?? '?'} @ ${short(verdict.reportedCommit)}  (channel ${verdict.channel ?? '?'}, built ${verdict.builtAt ?? '?'})`,
  ];
  if (!verdict.stamped) return [...header, `Result      : WARN  ${verdict.detail}`].join('\n');

  const mark = verdict.versionCommit.ok === true ? 'OK  ' : verdict.versionCommit.ok === null ? 'SKIP' : 'FAIL';
  return [
    ...header,
    `Version<->SHA: ${mark} ${verdict.versionCommit.note}`,
    ...comparisonLines(verdict),
    `Result      : ${verdict.result.toUpperCase()}`,
  ].join('\n');
}

function render(verdict, { json = false } = {}) {
  if (!json) return renderText(verdict);
  const { exitCode, ...rest } = verdict; // exit code is for the shell, not the document
  return JSON.stringify(rest, null, 2);
}

module.exports = { render };
