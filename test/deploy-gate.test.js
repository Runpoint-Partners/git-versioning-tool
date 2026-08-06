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
    verify.keys.if && verify.keys.if.includes("!= ''"),
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
