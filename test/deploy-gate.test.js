'use strict';

// THE DEPLOY PIPELINE MUST NOT REPORT A FAILED VERIFICATION AS SUCCESS.
//
// The CLI already gets this right — `verify` exits 1 on INCONSISTENT and 3 on UNVERIFIABLE, and
// verify.test.js pins both. The gap was one layer up: the reusable workflow ran that command under
// `continue-on-error: true`, so every verdict it produced was discarded and the deploy reported
// green regardless. No test could see that, because no test read the workflow.
//
// These cases read the workflow itself. The repo is dependency-free, so rather than pull in a YAML
// parser this walks the file by indentation — collecting each `- name:` step and the keys that
// belong to it — which is a real structural parse, not a pattern match over the text.
// The final case exercises the real verifier and scheme over an entirely stubbed Git gateway.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const WORKFLOW = path.resolve(__dirname, '..', '.github', 'workflows', 'versioned-deploy.yml');

// Collect the workflow's steps. A step starts at a `- name:` line; every following line indented
// deeper than that marker, up to the next marker at the same depth, belongs to it.
function readSteps() {
  const lines = fs.readFileSync(WORKFLOW, 'utf8').split('\n');
  const steps = [];
  let current = null;
  for (const line of lines) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    const nameMatch = line.trim().match(/^-\s+name:\s*(.*)$/);
    if (nameMatch) {
      current = { name: nameMatch[1].trim(), indent, keys: {}, body: [] };
      steps.push(current);
      continue;
    }
    if (current === null) continue;
    if (indent <= current.indent) { current = null; continue; }
    current.body.push(line);
    const keyMatch = line.trim().match(/^([a-zA-Z-]+):\s*(.*)$/);
    // Strip a YAML inline comment before storing the value. Without this,
    // `continue-on-error: true # informational` reads as the string
    // "true # informational" and an equality check against "true" silently misses it —
    // which is exactly how the swallowed step would have slipped past this gate.
    if (keyMatch) current.keys[keyMatch[1]] = keyMatch[2].replace(/\s+#.*$/, '').trim();
  }
  return steps;
}

const isVerificationStep = (step) => step.name.toLowerCase().startsWith('verify');

test('the deploy workflow actually has a verification step', () => {
  const steps = readSteps();
  assert.ok(steps.some(isVerificationStep), 'no step named "Verify" — the deploy has no post-deploy gate at all');
});

test('verification never runs under continue-on-error', () => {
  const swallowed = readSteps()
    .filter(isVerificationStep)
    .filter((step) => step.keys['continue-on-error'] === 'true')
    .map((step) => step.name);
  assert.deepStrictEqual(
    swallowed, [],
    `these verification steps discard their verdict and report the deploy green: ${swallowed.join(', ')}`,
  );
});

test('verification runs whenever the channel declares a URL', () => {
  const verify = readSteps().find(isVerificationStep);
  assert.ok(verify, 'no verification step');
  assert.ok(
    verify.keys.if === "steps.verifiable.outputs.present == 'true'",
    'the verification step must be conditioned on a declared channel URL, so that a channel which CAN be verified always is',
  );
});

test('a channel that cannot be verified says so instead of passing quietly', () => {
  const steps = readSteps();
  const skipNotice = steps.find((step) => step.name.toLowerCase().includes('skipped'));
  assert.ok(skipNotice, 'no step announces a skipped verification — an unverifiable channel would look identical to a verified one');
  const body = skipNotice.body.join('\n');
  assert.match(body, /::warning/, 'the skip must raise a warning annotation');
  assert.match(body, /GITHUB_STEP_SUMMARY/, 'the skip must be recorded in the job summary');
});

test('verification targets the deployed checkout and SSH cleanup runs after failure/cancellation', () => {
  const steps = readSteps();
  const verify = steps.find(isVerificationStep);
  assert.match(verify.keys.run, /"--ref=HEAD"/);
  const cleanup = steps.find((step) => step.name === 'Remove SSH key');
  assert.ok(cleanup, 'no SSH cleanup step');
  assert.strictEqual(cleanup.keys.if, "always() && steps.strat.outputs.name == 'server-ssh'");
  assert.strictEqual(steps.at(-1), cleanup, 'cleanup must also follow a failed Verify step');
  assert.notStrictEqual(cleanup.keys['continue-on-error'], 'true');
});

test('real verifier accepts the intended rollback/ref certificate and rejects a stale origin/main certificate', () => {
  // Merely loading this gateway performs no Git operation. Replace EVERY exported entry point
  // before importing/evaluating the verifier; an unmodeled call throws instead of reaching git.
  const git = require('../lib/git');
  const originals = { ...git };
  for (const name of Object.keys(git)) {
    git[name] = () => { throw new Error(`unexpected Git gateway call: ${name}`); };
  }
  try {
    // A single synthetic lineage: release 1.3.0 -> one staging commit -> release 1.4.0 (main).
    const old = 'a'.repeat(40);
    const candidate = 'b'.repeat(40);
    const main = 'c'.repeat(40);
    const commits = [old, candidate, main];
    const refs = { HEAD: old, 'origin/main': main, 'v1.3.0': old, 'v1.4.0': main };
    const resolve = (ref) => refs[ref] || (commits.includes(ref) ? ref : null);
    const ordinal = (ref) => commits.indexOf(resolve(ref));
    git.revParse = resolve;
    git.commitExists = (ref) => resolve(ref) !== null;
    git.tagCommit = (tag) => refs[tag] || null;
    git.releaseTags = () => [
      { major: 1, minor: 3, tag: 'v1.3.0' },
      { major: 1, minor: 4, tag: 'v1.4.0' },
    ];
    git.isAncestor = (ancestor, descendant) => ordinal(ancestor) >= 0 && ordinal(descendant) >= ordinal(ancestor);
    git.commitCount = (range) => {
      const [from, to, extra] = range.split('..');
      assert.strictEqual(extra, undefined);
      assert.ok(ordinal(from) >= 0 && ordinal(to) >= ordinal(from), `unexpected fixture range: ${range}`);
      return ordinal(to) - ordinal(from);
    };

    const { evaluate } = require('../lib/verifier');
    const cases = [
      { name: 'production rollback', channel: 'production', head: old, version: '1.3.0' },
      { name: 'staging rollback', channel: 'staging', head: old, version: '1.3.0' },
      { name: 'production explicit release ref', channel: 'production', head: old, version: '1.3.0' },
      { name: 'staging explicit commit ref', channel: 'staging', head: candidate, version: '1.3.1' },
    ];
    for (const fixture of cases) {
      refs.HEAD = fixture.head;
      const certificate = { channel: fixture.channel, version: fixture.version, gitCommit: fixture.head };
      const intended = evaluate(certificate, { environment: fixture.name, ref: 'HEAD' });
      assert.strictEqual(intended.exitCode, 0, fixture.name);
      assert.strictEqual(intended.latestRef, 'HEAD');
      assert.strictEqual(intended.latestVersion, fixture.version);
      assert.strictEqual(intended.freshness.state, 'equal');

      const stale = { channel: fixture.channel, version: '1.4.0', gitCommit: main };
      const rejected = evaluate(stale, { environment: fixture.name, ref: 'HEAD' });
      assert.strictEqual(rejected.versionCommit.ok, true, 'stale certificate is internally truthful');
      assert.strictEqual(rejected.exitCode, 1, 'it still reports the wrong deployed commit');
      // Expose the old wrong-target behavior as a control, rather than merely checking canned exits.
      assert.strictEqual(evaluate(stale).exitCode, 0, 'default origin/main accepts the stale live state');
      assert.strictEqual(evaluate(certificate).exitCode, 1, 'default origin/main rejects the intended older checkout');
    }
    refs.HEAD = main;
    assert.strictEqual(evaluate({ channel: 'production', version: '1.4.0', gitCommit: main }, { ref: 'HEAD' }).exitCode, 0);
    assert.strictEqual(evaluate({ channel: 'staging', version: '1.3.0', gitCommit: 'd'.repeat(40) }, { ref: 'HEAD' }).exitCode, 3);
    assert.strictEqual(evaluate({ channel: 'local', gitCommit: 'unstamped' }, { ref: 'HEAD' }).exitCode, 3);
  } finally {
    Object.assign(git, originals);
  }
});
