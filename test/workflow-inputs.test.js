'use strict';

// Exercise the actual reusable-workflow shell snippets, never the rpv implementation or a
// deployment. PATH contains ONLY stubs (including git, npm, curl, SSH and the jq field reader).
// Every subprocess gets a fresh temporary HOME/workspace and no inherited credentials/config.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/versioned-deploy.yml'), 'utf8');

// Dependency-free reader for this file's block/inline run steps, env maps and simple conditions.
// These supported forms are deliberately narrow; this is not a YAML/Actions parser.
function readSteps() {
  const steps = [];
  for (const line of workflow.split('\n')) {
    const start = line.match(/^      - (name|uses): (.+)$/);
    if (start) {
      steps.push({ name: start[2], uses: start[1] === 'uses', lines: [] });
    } else if (steps.length) steps.at(-1).lines.push(line);
  }
  for (const step of steps) {
    step.env = {};
    for (let i = 0; i < step.lines.length; i++) {
      const line = step.lines[i];
      const key = line.match(/^        (id|if|uses|shell): (.+)$/);
      if (key) step[key[1]] = key[2];
      const env = line.match(/^          ([A-Z_]+): (.+)$/);
      if (env) step.env[env[1]] = env[2];
      const run = line.match(/^        run: (.+)$/);
      if (!run) continue;
      assert.ok(!step.script, `duplicate run in ${step.name}`);
      if (run[1] !== '|') {
        assert.ok(!/^[>|'\"]/.test(run[1]), 'unsupported run scalar');
        step.script = run[1];
      } else {
        const body = [];
        while (i + 1 < step.lines.length && /^( {10}|\s*$)/.test(step.lines[i + 1])) {
          body.push(step.lines[++i].slice(10));
        }
        step.script = body.join('\n');
      }
    }
    assert.ok(step.script || step.uses, `unreadable step ${step.name}`);
  }
  return steps;
}
const steps = readSteps();
function readJobEnv(source) {
  return Object.fromEntries(
    [...source.split('    steps:')[0].matchAll(/^      ([A-Z_]+): (.+)$/gm)]
      .map((m) => [m[1], m[2]]),
  );
}
const jobEnv = readJobEnv(workflow);

// Context availability is location-specific even when the fixture has values for every root.
// These are the two env locations used here, not a complete Actions expression/schema checker.
const jobEnvContexts = ['github', 'needs', 'strategy', 'matrix', 'vars', 'secrets', 'inputs'];
const envContexts = {
  job: new Set(jobEnvContexts),
  step: new Set([...jobEnvContexts, 'job', 'runner', 'env', 'steps']),
};

function interpolateData(value, context, location) {
  assert.ok(Object.hasOwn(envContexts, location), 'env location must be explicit');
  return value.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, key) => {
    assert.match(key, /^[A-Za-z_][A-Za-z_.-]*$/);
    const root = key.split('.')[0];
    assert.ok(envContexts[location].has(root), `${root} context is unavailable in ${location} env`);
    return key.split('.').reduce((obj, part) => obj?.[part], context) ?? '';
  });
}

function resolveEnvironment(bindings, context, location) {
  return Object.fromEntries(Object.entries(bindings).map(([name, value]) => [name, interpolateData(value, context, location)]));
}

// Generic JSON field selection, not a reimplementation of the validation under test: all
// grammar checks and branching execute from the workflow's own shell source.
const stubSource = String.raw`
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const [command, ...args] = process.argv.slice(2);
const fixture = JSON.parse(process.env.TEST_FIXTURE);
fs.appendFileSync(process.env.TEST_LOG, JSON.stringify({ command, args }) + '\n');
const print = (value) => process.stdout.write(String(value) + '\n');
const fail = () => { process.stderr.write('unexpected stub invocation\n'); process.exit(99); };
const failure = fixture.failure;
if (failure && failure.command === command && failure.args.every((arg, i) => args[i] === arg)) {
  process.exit(failure.status);
}
const keyDirectory = path.join(process.env.RUNNER_TEMP, 'rpv-ssh');
const keyFile = path.join(keyDirectory, 'deploy_key');
switch (command) {
  case 'rpv':
    if (process.env.DEPLOY_SSH_KEY_PATH !== keyFile) fail(); // Config reads need the step-local binding.
    if (args[0] === 'config' && args[1] === 'get') print(fixture.config[args[2]] ?? '');
    else if (['resolve-release', 'rollback-target'].includes(args[0])) print(JSON.stringify(fixture.release));
    else if (!['stamp', 'deploy', 'verify'].includes(args[0])) fail();
    break;
  case 'jq': {
    if (args.length !== 2 || args[0] !== '-r' || !/^\.[A-Za-z]+$/.test(args[1])) fail();
    const value = JSON.parse(fs.readFileSync(0, 'utf8'))[args[1].slice(1)];
    print(value == null ? 'null' : typeof value === 'object' ? JSON.stringify(value) : value);
    break;
  }
  case 'curl': print(JSON.stringify(fixture.live)); break;
  case 'git':
  case 'npm': break; // No repository, package or release-state operations.
  case 'chmod':
    if (args.length !== 2 || args[0] !== '600' || args[1] !== keyFile) fail();
    fs.chmodSync(keyFile, 0o600);
    break;
  case 'install':
    if (args.slice(0, 3).join(' ') !== '-m 700 -d') fail();
    for (const dir of args.slice(3)) {
      if (![path.join(process.env.HOME, '.ssh'), keyDirectory].includes(dir)) fail();
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.chmodSync(dir, 0o700);
    }
    break;
  case 'rm':
    if (args.length !== 3 || args[0] !== '-f' || args[1] !== '--' || args[2] !== keyFile) fail();
    try { fs.unlinkSync(keyFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    break;
  case 'rmdir':
    if (args.length !== 2 || args[0] !== '--' || args[1] !== keyDirectory) fail();
    fs.rmdirSync(keyDirectory); // Nonrecursive: never remove unrelated fixture files.
    break;
  case 'ssh-keyscan': print('fixture-host fixture-key'); break;
  default: fail();
}
`;

function scenario(t, { inputs = {}, release = {}, config = {}, live, secret = '', failure, cancelAfter } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpv-workflow-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  const workspace = path.join(root, 'workspace');
  const runnerTemp = path.join(root, 'runner-temp');
  const home = path.join(root, 'home');
  for (const dir of [bin, workspace, runnerTemp, home]) fs.mkdirSync(dir);
  fs.mkdirSync(path.join(workspace, '.rpv'));
  fs.writeFileSync(path.join(workspace, '.rpv/keep'), 'application fixture');
  const stub = path.join(root, 'stub.js');
  fs.writeFileSync(stub, stubSource);
  for (const command of ['rpv', 'git', 'npm', 'curl', 'jq', 'install', 'chmod', 'ssh-keyscan', 'rm', 'rmdir']) {
    fs.writeFileSync(path.join(bin, command), '#!/bin/bash\nexec "$TEST_NODE" "$TEST_STUB" "${0##*/}" "$@"\n', { mode: 0o700 });
  }
  const log = path.join(root, 'commands.jsonl');
  fs.writeFileSync(log, '');
  const fixture = {
    release: { version: '1.3.0', tag: 'v1.3.0', createTag: true, ...release },
    config: {
      'deploy.strategy': 'library', 'deploy.host': 'fixture.invalid',
      'channels.production.url': 'https://fixture.invalid',
      'channels.staging.url': 'https://staging.invalid',
      'channelConfig.url': 'https://fixture.invalid', ...config,
    },
    live: live ?? { version: '2.4.9' }, failure,
  };
  const context = {
    inputs: { channel: 'production', package: '', release: 'minor', rollback: '', ...inputs },
    vars: {}, github: { workspace }, runner: { temp: runnerTemp },
    secrets: { DEPLOY_SSH_KEY: secret }, steps: {},
  };
  const env = {
    PATH: bin, HOME: home, LANG: 'C', TEST_ROOT: root,
    RUNNER_TEMP: runnerTemp, GITHUB_WORKSPACE: workspace,
    TEST_NODE: process.execPath, TEST_STUB: stub, TEST_LOG: log,
    TEST_MARKER: path.join(root, 'injected'), TEST_FIXTURE: JSON.stringify(fixture),
    GITHUB_STEP_SUMMARY: path.join(root, 'summary'),
  };
  const resolvedJobEnv = resolveEnvironment(jobEnv, context, 'job');
  Object.assign(env, resolvedJobEnv);
  // This is the expected fixture file to observe, not an inherited environment binding.
  const keyPath = path.join(runnerTemp, 'rpv-ssh/deploy_key');
  const executed = [];
  const stepResults = [];
  const keySnapshots = [];
  // Inspect the real fixture tree without following symlinks (rsync -a also preserves them).
  const workspaceFiles = (dir = workspace) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? workspaceFiles(file) : [file];
  });
  let result = { status: 0, stderr: '' };
  let failedStep;
  let cancelled = false;
  for (const step of steps) {
    let condition;
    if (step.if) {
      condition = step.if.match(/^(always\(\) && )?steps\.([a-z]+)\.outputs\.([a-z]+) == '([^']*)'$/);
      assert.ok(condition, `unsupported condition ${step.if}`);
    }
    // Ordinary steps have GitHub's implicit success() guard; always() also schedules on failure/cancel.
    if ((failedStep || cancelled) && !condition?.[1]) continue;
    if (condition && context.steps[condition[2]]?.outputs[condition[3]] !== condition[4]) continue;
    executed.push(step.name);
    if (!step.script) continue; // Action implementations are never executed.
    assert.ok(!step.script.includes('${{'), 'refuse to execute expression-bearing shell source');
    const output = path.join(root, `output-${executed.length}`);
    fs.writeFileSync(output, '');
    const stepEnv = {
      ...env, GITHUB_OUTPUT: output,
      ...resolveEnvironment(step.env, { ...context, env: resolvedJobEnv }, 'step'),
    };
    for (const name of ['DEPLOY_SSH_KEY_PATH', 'RPV_SSH_KEY_DIR']) {
      if (Object.hasOwn(stepEnv, name)) {
        assert.ok(path.resolve(stepEnv[name]).startsWith(root + path.sep), `${name} escaped fixture root`);
      }
    }
    const script = path.join(root, 'step.sh');
    fs.writeFileSync(script, step.script);
    const stepResult = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', script], {
      cwd: workspace, env: stepEnv, encoding: 'utf8', timeout: 5000,
    });
    stepResults.push({ name: step.name, status: stepResult.status });
    if (fs.existsSync(keyPath)) {
      keySnapshots.push({
        step: step.name, path: keyPath,
        content: fs.readFileSync(keyPath, 'utf8'),
        mode: fs.statSync(keyPath).mode & 0o777,
        directoryMode: fs.statSync(path.dirname(keyPath)).mode & 0o777,
        workspaceFiles: workspaceFiles(),
      });
    }
    if (stepResult.status !== 0) {
      if (!failedStep && !cancelled) { result = stepResult; failedStep = step.name; }
      continue; // Run cleanup without replacing the failed verdict with cleanup's successful exit.
    }
    const outputs = {};
    for (const line of fs.readFileSync(output, 'utf8').split('\n').filter(Boolean)) {
      const pair = line.match(/^([a-z]+)=(.*)$/);
      assert.ok(pair, `unexpected output line ${line}`);
      assert.equal(Object.hasOwn(outputs, pair[1]), false, 'duplicate output');
      outputs[pair[1]] = pair[2];
    }
    if (step.id) context.steps[step.id] = { outputs };
    if (step.name === cancelAfter && !failedStep) {
      cancelled = true;
      result = { status: 130, stderr: 'synthetic cancellation between steps' };
    }
  }
  assert.equal(fs.existsSync(env.TEST_MARKER), false, 'shell evaluated input data');
  return {
    ...result, failedStep, cancelled, executed, stepResults, keySnapshots,
    outputs: context.steps, root, workspace, runnerTemp, keyPath,
    calls: fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)),
  };
}
const calls = (result, command, verb) => result.calls.filter((call) => call.command === command && (!verb || call.args[0] === verb));
const success = (result) => assert.equal(result.status, 0, `${result.failedStep}: ${result.stderr}`);

test('validation is first; every expression stays outside shell source', () => {
  assert.equal(steps[0].name, 'Validate workflow inputs');
  assert.equal(steps[0].shell, 'bash');
  assert.ok(steps.length >= 14, 'reader missed workflow steps');
  for (const step of steps.filter((step) => step.script)) {
    assert.ok(!step.script.includes('${{'), step.name);
    assert.doesNotMatch(step.script, /\beval\b|\b(?:ba)?sh\s+-c\b/);
  }
  for (const input of ['channel', 'package', 'release', 'rollback']) {
    assert.equal(jobEnv[`RPV_${input.toUpperCase()}`], '${{ inputs.' + input + ' }}');
  }
  assert.match(workflow, /contents: write/);
});

test('env contexts are checked by location, including the rejected job-env runner placement', () => {
  const context = { runner: { temp: 'fixture-runner-temp' }, inputs: {}, vars: {}, secrets: {}, steps: {} };
  assert.doesNotThrow(() => resolveEnvironment(jobEnv, context, 'job'));
  for (const step of steps) {
    assert.doesNotThrow(() => resolveEnvironment(step.env, context, 'step'), step.name);
  }

  // Reintroduce R2-CONTEXT-001 into an inert copy of the actual YAML. Having runner data in
  // the fixture must not make this unsupported job-level binding appear valid.
  const invalidWorkflow = workflow.replace(
    '    env:\n',
    '    env:\n      DEPLOY_SSH_KEY_PATH: ${{ runner.temp }}/rpv-ssh/deploy_key\n',
  );
  assert.notEqual(invalidWorkflow, workflow, 'mutation must reach the job env');
  assert.throws(
    () => resolveEnvironment(readJobEnv(invalidWorkflow), context, 'job'),
    /runner context is unavailable in job env/,
  );
  assert.equal(
    interpolateData('${{ runner.temp }}/rpv-ssh/deploy_key', context, 'step'),
    'fixture-runner-temp/rpv-ssh/deploy_key',
  );
  for (const unavailable of ['env', 'steps', 'job']) {
    assert.throws(
      () => interpolateData('${{ ' + unavailable + '.value }}', context, 'job'),
      new RegExp(`${unavailable} context is unavailable in job env`),
    );
  }
});

test('every CLI config consumer gets its own fixed step-level key path', () => {
  assert.equal(Object.hasOwn(jobEnv, 'DEPLOY_SSH_KEY_PATH'), false);
  const configSteps = [
    'Resolve strategy', 'Configure SSH (server-ssh)', 'Resolve release', 'Stamp provenance',
    'Deploy', 'Can this channel be verified?', 'Verify',
  ];
  for (const name of configSteps) {
    const step = steps.find((item) => item.name === name);
    assert.ok(step, name);
    assert.equal(step.env.DEPLOY_SSH_KEY_PATH, '${{ runner.temp }}/rpv-ssh/deploy_key', name);
  }
  for (const name of ['Configure SSH (server-ssh)', 'Remove SSH key']) {
    assert.equal(steps.find((step) => step.name === name).env.RPV_SSH_KEY_DIR, '${{ runner.temp }}/rpv-ssh');
  }
});

const hostile = [
  'production; printf injected > "$TEST_MARKER"',
  '$(printf injected > "$TEST_MARKER")', '`printf injected > "$TEST_MARKER"`',
  '"; printf injected > "$TEST_MARKER"; #', "single'quote",
  'production\nprintf injected > "$TEST_MARKER"', 'minor\n', 'major\r',
  '--production', '-n', '*', 'production staging', '1.2.3;false',
];
for (const input of ['channel', 'release', 'rollback']) {
  test(`${input}: reject shell syntax, newlines, quotes and leading flags before external work`, (t) => {
    const invalid = [...hostile, ...(input === 'channel' ? ['', 'preview'] : ['patch', 'v1.3.0', '1.3.0-beta'])];
    for (const value of invalid) {
      const result = scenario(t, { inputs: { [input]: value } });
      assert.equal(result.status, 2, JSON.stringify(value));
      assert.equal(result.failedStep, 'Validate workflow inputs');
      assert.deepEqual(result.calls, []);
      assert.deepEqual(result.executed, ['Validate workflow inputs']);
    }
  });
}

test('production preserves minor/major/default/empty release and no-tag redeploy', (t) => {
  for (const release of [undefined, '', 'minor', 'major']) {
    for (const createTag of [true, false]) {
      const result = scenario(t, { inputs: release === undefined ? {} : { release }, release: { createTag } });
      success(result);
      assert.deepEqual(calls(result, 'rpv', 'resolve-release')[0].args, ['resolve-release', `--release=${release || 'minor'}`]);
      assert.equal(calls(result, 'git', 'tag').length, createTag ? 1 : 0);
      assert.equal(calls(result, 'git', 'push').length, createTag ? 1 : 0);
      if (createTag) {
        assert.deepEqual(calls(result, 'git', 'tag')[0].args, ['tag', '-a', '-m', 'Release 1.3.0 (production)', '--', 'v1.3.0']);
        assert.deepEqual(calls(result, 'git', 'push')[0].args, ['push', 'origin', 'refs/tags/v1.3.0']);
      }
      assert.deepEqual(calls(result, 'rpv', 'stamp')[0].args, ['stamp', '--channel=production', '--version=1.3.0', '--package=']);
      assert.deepEqual(calls(result, 'rpv', 'verify')[0].args, ['verify', '--production', '--ref=HEAD', '--package=']);
    }
  }
});

test('staging with empty rollback stamps the current patch without resolving or tagging a release', (t) => {
  const result = scenario(t, { inputs: { channel: 'staging', release: '', rollback: '' } });
  success(result);
  assert.deepEqual(result.outputs.rel.outputs, { create: 'false', version: '', tag: '' });
  assert.deepEqual(calls(result, 'git'), []);
  assert.deepEqual(calls(result, 'rpv', 'resolve-release'), []);
  assert.deepEqual(calls(result, 'rpv', 'stamp')[0].args, ['stamp', '--channel=staging', '--package=']);
  assert.deepEqual(calls(result, 'rpv', 'verify')[0].args, ['verify', '--staging', '--ref=HEAD', '--package=']);
});

test('rollback accepts relative and numeric specs on both channels, normalizing the from-version only', (t) => {
  for (const channel of ['production', 'staging']) {
    for (const rollback of ['minor', 'major', '1.3', '1.3.0', '1.3.9', '01.03.0']) {
      const result = scenario(t, { inputs: { channel, rollback } });
      success(result);
      const relative = ['minor', 'major'].includes(rollback);
      const from = relative ? '2.4.9' : rollback === '1.3' ? '1.3.0' : rollback;
      assert.deepEqual(calls(result, 'rpv', 'rollback-target')[0].args, ['rollback-target', from, rollback]);
      assert.equal(calls(result, 'curl').length, relative ? 1 : 0);
      if (relative) assert.deepEqual(calls(result, 'curl')[0].args, ['-fsS', '--', `${channel === 'production' ? 'https://fixture.invalid' : 'https://staging.invalid'}/version`]);
      assert.deepEqual(calls(result, 'git')[0].args, ['checkout', '--quiet', '--detach', 'refs/tags/v1.3.0']);
      assert.equal(calls(result, 'git').length, 1);
      assert.equal(result.outputs.rel.outputs.create, 'false');
      assert.deepEqual(calls(result, 'rpv', 'verify')[0].args, ['verify', `--${channel}`, '--ref=HEAD', '--package=']);
    }
  }
});

test('package names are single literal argv values, including empty, scoped, whitespace and leading flags', (t) => {
  for (const packageName of ['', '@scope/web', 'web client', '--production', ...hostile]) {
    const result = scenario(t, { inputs: { package: packageName } });
    success(result);
    for (const call of calls(result, 'rpv').filter((call) => call.args[0] !== 'resolve-release')) {
      assert.equal(call.args.at(-1), `--package=${packageName}`);
      assert.equal(call.args.filter((arg) => arg.startsWith('--package=')).length, 1);
    }
  }
});

test('explicit-ref deployments verify HEAD on both channels', (t) => {
  for (const channel of ['production', 'staging']) {
    const result = scenario(t, { inputs: { channel, ref: 'refs/heads/release-candidate' } });
    success(result);
    assert.deepEqual(calls(result, 'rpv', 'verify')[0].args, ['verify', `--${channel}`, '--ref=HEAD', '--package=']);
    assert.ok(result.executed.includes('actions/checkout@v4'));
  }
  assert.match(workflow, /ref: \$\{\{ inputs\.ref \}\}/); // Checkout itself is an unexecuted action.
});

function assertKeyRemoved(result) {
  assert.deepEqual(result.stepResults.at(-1), { name: 'Remove SSH key', status: 0 });
  assert.deepEqual(calls(result, 'rm')[0].args, ['-f', '--', path.join(result.runnerTemp, 'rpv-ssh/deploy_key')]);
  assert.equal(calls(result, 'rm').length, 1);
  assert.equal(fs.existsSync(result.keyPath), false);
  assert.equal(fs.existsSync(path.join(result.runnerTemp, 'rpv-ssh')), false);
  assert.equal(fs.readFileSync(path.join(result.workspace, '.rpv/keep'), 'utf8'), 'application fixture');
}

test('synthetic SSH key is literal, private, outside the rsync source and removed after success', (t) => {
  const secret = ['synthetic key', ...hostile, 'end synthetic key'].join('\n');
  for (const url of ['https://fixture.invalid', '']) {
    const result = scenario(t, { config: { 'deploy.strategy': 'server-ssh', 'channelConfig.url': url }, secret });
    success(result);
    assert.equal(result.keyPath, path.join(result.runnerTemp, 'rpv-ssh/deploy_key'));
    assert.ok(!result.keyPath.startsWith(result.workspace + path.sep));
    assert.ok(result.keySnapshots.some((snapshot) => snapshot.step === 'Deploy'), 'key must exist when deploying');
    for (const snapshot of result.keySnapshots) {
      assert.equal(snapshot.content, secret + '\n');
      assert.equal(snapshot.mode, 0o600);
      assert.equal(snapshot.directoryMode, 0o700);
      assert.deepEqual(snapshot.workspaceFiles, [path.join(result.workspace, '.rpv/keep')]);
    }
    assert.equal(calls(result, 'ssh-keyscan').length, 1);
    assert.deepEqual(calls(result, 'rmdir')[0].args, ['--', path.join(result.runnerTemp, 'rpv-ssh')]);
    assertKeyRemoved(result);
  }
});

test('invalid release output cannot become checkout, tags, stamp data or extra workflow outputs', (t) => {
  const invalid = [
    { version: '1.3.0\ncreate=true' }, { tag: 'v1.3.0\ncreate=true' },
    { version: '$(printf injected > "$TEST_MARKER")' }, { tag: '--force' },
    { tag: 'v9.9.0' }, { version: '1.3.1', tag: 'v1.3.1' },
  ];
  for (const release of invalid) {
    for (const rollback of ['', '1.3.0']) {
      const result = scenario(t, { release, inputs: { rollback } });
      assert.equal(result.status, 2);
      assert.equal(result.failedStep, 'Resolve release');
      assert.deepEqual(calls(result, 'git'), []);
      assert.deepEqual(calls(result, 'rpv', 'stamp'), []);
      assert.deepEqual(calls(result, 'rpv', 'deploy'), []);
      assert.equal(result.outputs.rel, undefined);
    }
  }
  for (const createTag of ['true\nversion=9.9.0', '--force', null]) {
    const result = scenario(t, { release: { createTag } });
    assert.equal(result.status, 2);
    assert.deepEqual(calls(result, 'git'), []);
  }
});

test('relative rollback rejects a malformed live version before calling rollback-target', (t) => {
  for (const version of [...hostile, '', '1.3', null]) {
    const result = scenario(t, { inputs: { rollback: 'minor' }, live: { version } });
    assert.equal(result.status, 2);
    assert.equal(result.failedStep, 'Resolve release');
    assert.deepEqual(calls(result, 'rpv', 'rollback-target'), []);
    assert.deepEqual(calls(result, 'git'), []);
  }
});

test('strategy and URL outputs carry bounded decisions, including custom modules and missing URLs', (t) => {
  for (const strategy of ['static-s3', './custom strategy.js', 'server-ssh\nname=static-s3']) {
    for (const url of ['', 'https://fixture.invalid', 'https://fixture.invalid\npresent=false']) {
      const result = scenario(t, { config: { 'deploy.strategy': strategy, 'channelConfig.url': url } });
      success(result);
      assert.deepEqual(result.outputs.strat.outputs, { name: strategy === 'static-s3' ? 'static-s3' : 'other' });
      assert.deepEqual(result.outputs.verifiable.outputs, { present: url ? 'true' : 'false' });
      assert.equal(calls(result, 'rpv', 'verify').length, url ? 1 : 0);
      assert.equal(result.executed.some((name) => name.startsWith('Verification skipped')), !url);
      assert.equal(result.executed.includes('Configure AWS (static-s3)'), strategy === 'static-s3');
    }
  }
});

test('failed config resolution stops the job instead of skipping verification or deploying', (t) => {
  const result = scenario(t, { failure: { command: 'rpv', args: ['config', 'get', 'deploy.strategy'], status: 17 } });
  assert.equal(result.status, 17);
  assert.equal(result.failedStep, 'Resolve strategy');
  assert.deepEqual(calls(result, 'git'), []);
  assert.deepEqual(calls(result, 'rpv', 'deploy'), []);
  assert.deepEqual(calls(result, 'rm'), []);
});

test('late lookup, deploy and verification failures retain their exit codes after SSH cleanup', (t) => {
  const failures = [
    { args: ['deploy'], status: 23, step: 'Deploy', verifyCalls: 0 },
    { args: ['config', 'get', 'channelConfig.url'], status: 17, step: 'Can this channel be verified?', verifyCalls: 0 },
    { args: ['verify'], status: 1, step: 'Verify', verifyCalls: 1 },
    { args: ['verify'], status: 3, step: 'Verify', verifyCalls: 1 },
  ];
  for (const channel of ['production', 'staging']) {
    for (const failure of failures) {
      const result = scenario(t, {
        inputs: { channel }, config: { 'deploy.strategy': 'server-ssh' }, secret: 'synthetic key only',
        failure: { command: 'rpv', args: failure.args, status: failure.status },
      });
      assert.equal(result.status, failure.status, `${channel}: ${failure.step}`);
      assert.equal(result.failedStep, failure.step);
      assert.equal(calls(result, 'rpv', 'deploy').length, 1, 'failure must occur after deploy is reached');
      assert.equal(calls(result, 'rpv', 'verify').length, failure.verifyCalls);
      assert.equal(result.executed.some((name) => name.startsWith('Verification skipped')), false);
      assert.ok(result.keySnapshots.some((snapshot) => snapshot.step === failure.step));
      if (failure.verifyCalls) {
        assert.deepEqual(calls(result, 'rpv', 'verify')[0].args, ['verify', `--${channel}`, '--ref=HEAD', '--package=']);
      } else {
        assert.equal(result.outputs.verifiable, undefined, 'failed/missing URL lookup must not emit a skip decision');
      }
      assertKeyRemoved(result);
    }
  }
});

test('partially failed SSH setup removes the key that was already written', (t) => {
  const result = scenario(t, {
    config: { 'deploy.strategy': 'server-ssh' }, secret: 'synthetic key only',
    failure: { command: 'ssh-keyscan', args: [], status: 17 },
  });
  assert.equal(result.status, 17);
  assert.equal(result.failedStep, 'Configure SSH (server-ssh)');
  assert.ok(result.keySnapshots.some((snapshot) => snapshot.step === result.failedStep));
  assert.deepEqual(calls(result, 'rpv', 'deploy'), []);
  assertKeyRemoved(result);
});

test('simulated cancellation between steps schedules only the applicable always cleanup', (t) => {
  for (const cancelAfter of ['Resolve strategy', 'Configure SSH (server-ssh)', 'Deploy']) {
    const result = scenario(t, {
      config: { 'deploy.strategy': 'server-ssh' }, secret: 'synthetic key only', cancelAfter,
    });
    assert.equal(result.status, 130);
    assert.equal(result.cancelled, true);
    assert.equal(result.failedStep, undefined);
    assert.deepEqual(result.executed.slice(result.executed.indexOf(cancelAfter) + 1), ['Remove SSH key']);
    assert.deepEqual(calls(result, 'rpv', 'verify'), []);
    assert.equal(result.keySnapshots.length > 0, cancelAfter !== 'Resolve strategy');
    assertKeyRemoved(result);
  }
});

test('a cleanup error fails an otherwise successful job', (t) => {
  const result = scenario(t, {
    config: { 'deploy.strategy': 'server-ssh' }, secret: 'synthetic key only',
    failure: { command: 'rm', args: ['-f', '--'], status: 19 },
  });
  assert.equal(result.status, 19);
  assert.equal(result.failedStep, 'Remove SSH key');
  assert.equal(calls(result, 'rpv', 'verify').length, 1);
  assert.equal(fs.existsSync(result.keyPath), true); // Fixture teardown, not workflow cleanup, removes this synthetic key.
  assert.deepEqual(calls(result, 'rmdir'), []);
});
