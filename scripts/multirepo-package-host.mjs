import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const [manifestPath, mode] = process.argv.slice(2);
const fixture = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const { root, evidence, packageRoot, gitPort, apiPort } = fixture;
const yaml = createRequire(path.join(packageRoot, 'package.json'))('yaml');
const entry = path.join(packageRoot, 'bin', 'repoctopus.js');
const supervisor = path.join(import.meta.dirname, 'package-e2e-command.mjs');
const project = path.join(root, 'project');
const workspaceId = 'workspace';
const workspace = path.join(project, workspaceId);
const driftScenario = process.env.REPOCTOPUS_WORKFLOW_E2E_DRIFT;
assert(
  [
    undefined,
    'readonly-sync',
    'external-commit',
    'future-backend',
    'read-input',
    'active-read-input',
    'completed-read-input',
  ].includes(driftScenario),
);
const readConsumer =
  driftScenario === 'completed-read-input'
    ? 'web-front'
    : ['read-input', 'active-read-input'].includes(driftScenario)
      ? 'backend'
      : null;
const observer =
  readConsumer || driftScenario === 'readonly-sync'
    ? 'web-plugins'
    : driftScenario === 'external-commit'
      ? 'backend'
      : null;
const business = ['web-front', observer === 'backend' ? 'framework' : 'backend'];
const participants = observer ? [...business, observer] : business;
const expectedDecisions = [
  'specification-open',
  'specification-design',
  ...(readConsumer ? ['build-plan-risk'] : []),
];
const names = [workspaceId, ...participants];
const changeId = 'verify-package-workflow';
const branch = 'change/' + changeId;
const target = 'main';
const remoteHost = 'github-fixture.localhost';
const markerPath = 'docs/acceptance.txt';
const externalPath = 'external-team.txt';
const markers = Object.fromEntries(business.map((name) => [name, 'Workflow acceptance ' + name]));
const env = {
  ...process.env,
  NODE_EXTRA_CA_CERTS: path.join(root, 'cert.pem'),
  XDG_DATA_HOME: path.join(root, 'data'),
  XDG_CONFIG_HOME: path.join(root, 'config'),
  USERPROFILE: path.join(root, 'user'),
  GIT_CONFIG_GLOBAL: path.join(root, 'gitconfig'),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
  OPENSPEC_TELEMETRY: '0',
  OPENSPEC_NO_UPDATE_CHECK: '1',
  REPOCTOPUS_DESKTOP_OTLP_MODE: 'removed',
  REPOCTOPUS_GITHUB_TOKEN: 'local-fixture-only',
};
for (const key of Object.keys(env)) {
  if (key.startsWith('OTEL_')) delete env[key];
}
const file = (name) => path.join(evidence, name + '.json');
const read = (name) => JSON.parse(fs.readFileSync(file(name), 'utf8'));
const exists = (name) => fs.existsSync(file(name));
const write = (name, value) => {
  fs.writeFileSync(file(name), JSON.stringify(value, null, 2) + '\n');
  return file(name);
};
const hash = (value) => 'sha256:' + createHash('sha256').update(value).digest('hex');
const state = exists('operator') ? read('operator') : {};
const log = (name, value) =>
  fs.appendFileSync(path.join(evidence, name), JSON.stringify(value) + '\n');
const repository = (name) => path.join(project, name);

function run(command, argv, cwd, expected = [0]) {
  const result = spawnSync(process.execPath, [supervisor, '90000', command, ...argv], {
    cwd,
    env,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  log('commands.jsonl', {
    command,
    argv,
    cwd,
    pid: result.pid,
    exit: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  });
  if (result.error) throw result.error;
  assert(
    expected.includes(result.status),
    argv.join(' ') + '\n' + result.stderr + '\n' + result.stdout,
  );
  return result;
}

const git = (name, ...argv) => run('git', argv, repository(name)).stdout.trim();
function cli(label, argv, expectOk = true) {
  const result = run(
    process.execPath,
    [entry, ...argv, '--workspace', workspace, '--json'],
    workspace,
    [0, 1, 2],
  );
  const value = JSON.parse((result.status === 0 ? result.stdout : result.stderr) || result.stdout);
  write(label, value);
  assert.equal(value.ok, expectOk, JSON.stringify(value.diagnostics));
  return value;
}
const pull = (action, ...argv) =>
  cli(action + '-' + Date.now(), ['run', action, '--run', state.runId, ...argv]);
const status = () => pull('status').result;
const lifecycle = (view) => view.state.changeLifecycle;
function commit(name, title, files) {
  git(name, 'add', '--', ...files);
  git(name, 'commit', '--no-gpg-sign', '-m', title);
  git(name, 'push');
  return git(name, 'rev-parse', 'HEAD');
}
function projectApprove(label, prepared) {
  const {
    file: requestFile,
    request: { apiVersion, requestId, snapshotDigest },
  } = prepared.result;
  const response = write(label + '-response', {
    apiVersion,
    kind: 'HumanDecisionResponse',
    requestId,
    snapshotDigest,
    decision: 'approve',
  });
  cli(label + '-accepted', [
    'project',
    'review',
    '--request',
    requestFile,
    '--response-file',
    response,
  ]);
}
function plannedCheck(name, record) {
  return (
    "const fs=require('node:fs'),a=require('node:assert/strict');" +
    (record
      ? 'fs.appendFileSync(' +
        JSON.stringify(path.join(evidence, 'verify-commands.jsonl')) +
        ',JSON.stringify({repository:' +
        JSON.stringify(name) +
        ",pid:process.pid})+'\\n');"
      : '') +
    'a.equal(fs.readFileSync(' +
    JSON.stringify(markerPath) +
    ",'utf8')," +
    JSON.stringify(markers[name] + '\n') +
    ');'
  );
}

function initialize() {
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(env.GIT_CONFIG_GLOBAL, '');
  fs.mkdirSync(env.USERPROFILE, { recursive: true });
  for (const name of names) {
    fs.mkdirSync(repository(name));
    run('git', ['init', '--initial-branch=main'], repository(name));
    git(name, 'config', 'user.name', 'Repoctopus Package Fixture');
    git(name, 'config', 'user.email', 'fixture@example.invalid');
    git(name, 'config', 'http.curloptResolve', remoteHost + ':' + gitPort + ':127.0.0.1');
    git(name, 'config', 'http.proxy', '');
    git(name, 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(repository(name), 'README.md'), '# ' + name + '\n');
    git(name, 'add', '--', 'README.md');
    git(name, 'commit', '--no-gpg-sign', '-m', 'test: initialize package fixture');
    const bare = path.join(root, 'remotes', 'acceptance', name + '.git');
    fs.mkdirSync(path.dirname(bare), { recursive: true });
    run('git', ['init', '--bare', '--initial-branch=main', bare], root);
    run('git', ['--git-dir', bare, 'config', 'http.receivepack', 'true'], root);
    git(
      name,
      'remote',
      'add',
      'origin',
      'http://' + remoteHost + ':' + gitPort + '/acceptance/' + name + '.git',
    );
    git(name, 'push', '-u', 'origin', target);
  }
  projectApprove(
    'onboarding',
    cli('onboarding', [
      'project',
      'init',
      '--layout',
      'multi',
      '--scan-root',
      project,
      '--repositories',
      participants.join(','),
      '--entry-hosts',
      'codex',
      '--store',
      'package-workflow',
    ]),
  );
  const profile = {
    id: 'verify',
    nodes: business.map((name, index) => ({
      id: name + '-marker',
      repository: name,
      type: 'command',
      dependsOn: [],
      required: true,
      covers: ['task:1.' + (index + 1)],
      executable: process.execPath,
      args: ['-e', plannedCheck(name, true)],
      cwd: '.',
      timeoutMs: 30_000,
      cache: true,
      cacheTtlMs: 3_600_000,
      inputs: {
        schemaVersion: 1,
        repositories: [{ repository: name, files: [markerPath], outputs: [] }],
        git: 'none',
        env: [],
        taskCheckboxes: 'ignore',
      },
    })),
  };
  projectApprove(
    'configure-verify',
    cli('configure-verify', [
      'project',
      'configure-verify',
      '--candidate',
      write('profile', profile),
    ]),
  );
  const configFile = path.join(workspace, 'repoctopus.yaml');
  const config = yaml.parse(fs.readFileSync(configFile, 'utf8'));
  assert.equal(config.repositories.length, names.length);
  config.delivery = {
    checkpoint: {
      automatic: false,
      protectedBranches: ['main', 'master'],
      commitMessagePattern: '.+',
      quickChecks: {},
    },
    publication: {
      remote: 'origin',
      provider: 'github',
      githubApiBaseUrl: 'https://127.0.0.1:' + apiPort + '/api',
      mrTitleTemplate: '[Package test] {{changeId}}',
      mrBodyTemplate: '{{verificationReport}}',
      apiCredential: { provider: 'environment', variable: 'REPOCTOPUS_GITHUB_TOKEN' },
    },
  };
  fs.writeFileSync(configFile, yaml.stringify(config));
  for (const name of names) {
    if (git(name, 'status', '--porcelain'))
      commit(name, 'test: configure package acceptance', ['.']);
    git(name, 'switch', '-c', branch);
    git(name, 'push', '-u', 'origin', branch);
  }
  const started = cli('run-start', [
    'run',
    'start',
    '--change',
    changeId,
    '--target',
    target,
    '--execution-mode',
    'autonomous',
    '--tdd-mode',
    'tdd',
  ]);
  state.runId = started.runId;
  assert.equal(typeof state.runId, 'string');
  write('operator', state);
}

function claimCurrent() {
  const view = status();
  const l = lifecycle(view);
  assert(l.currentWork, 'No current Work');
  const key = 'claim-' + l.checkEpoch + '-' + l.currentWork.kind;
  let claim;
  if (exists(key)) claim = read(key).result;
  else {
    claim = cli(key, [
      'run',
      'work-claim',
      '--run',
      state.runId,
      '--runner',
      'package-fixture-host',
      '--adapter',
      'manual',
      '--attempt',
      '1',
      '--host-capabilities',
      [
        ...new Set([
          ...l.currentWork.capabilities,
          'build.autonomous',
          'evidence.write',
          'git.publish',
          'process.execute',
          'repository.read',
          'repository.write',
          'specification.read',
          'specification.write',
        ]),
      ].join(','),
    ]).result;
  }
  state.claim = key;
  write('operator', state);
  assert(
    claim.executionAcquired === true && claim.packet && claim.invocation,
    JSON.stringify(Object.keys(claim)),
  );
  return claim;
}
function check(name, desired) {
  return run(process.execPath, ['-e', plannedCheck(name, false)], repository(name), [desired]);
}
function inputFor(claim) {
  const layer = claim.packet.context.layers.find((x) => x.kind === 'change-inputs');
  return JSON.parse(layer.content);
}
function submit(claim, structured, message, outcomeStatus = 'succeeded') {
  const i = claim.invocation;
  const layers = claim.packet.context.layers.filter((x) =>
    ['action-skill', 'augmentation-skill'].includes(x.kind),
  );
  assert(layers.every((x) => typeof x.content === 'string'));
  const filename = structured
    ? write('result-' + i.invocationId.replaceAll(':', '-'), structured)
    : null;
  return pull(
    'work-outcome',
    '--submission-id',
    i.invocationId + ':1',
    '--invocation-id',
    i.invocationId,
    '--host-id',
    i.host.id,
    '--packet-digest',
    claim.packet.identity.packetDigest,
    '--status',
    outcomeStatus,
    '--summary',
    message,
    '--consumed-layers',
    layers.map((x) => x.digest).join(','),
    ...(filename ? ['--result-file', filename] : []),
  );
}
function build(claim) {
  const input = inputFor(claim);
  const l = lifecycle(status());
  const kind = l.currentWork.kind;
  let result;
  let message;
  if (kind === 'change.intake') {
    const spec = path.join(workspace, 'openspec', 'changes', changeId);
    const relative = 'openspec/changes/' + changeId;
    const capability = changeId + '-markers';
    assert.deepEqual(
      business.map((name) => fs.existsSync(path.join(repository(name), markerPath))),
      [false, false],
    );
    for (const name of business) assert(fs.existsSync(path.join(repository(name), 'README.md')));
    fs.mkdirSync(path.join(spec, 'specs', capability), { recursive: true });
    const draft = {
      'proposal.md':
        '# Proposal\n\n## Why\n\nExercise the packaged Windows multi-repository workflow through isolated Git publication and a local GitHub-compatible API.\n\n## What Changes\n\n- Add independent diagnostic markers to web-front and backend in the isolated acceptance branches.\n\n## Capabilities\n\n### New Capabilities\n\n- ' +
        capability +
        ': versioned acceptance markers used by the isolated Verify profile.\n\n## Impact\n\nTwo docs-only files in local experiment repositories. Publish three review requests against the isolated acceptance baseline. No production merges.\n',
      'design.md':
        '# Design\n\n## Context\n\nThree local experiment repositories use one newly initialized OpenSpec Store. Only web-front and backend need marker files.\n\n## Goals / Non-Goals\n\nVerify managed workflow behavior on the installed candidate. Keep changes and fixture PRs on isolated branches.\n\n## Decisions\n\nUse autonomous TDD and branch isolation. Each repository can be implemented and verified independently.\n',
      'tasks.md':
        '# Tasks\n\n## 1. Acceptance markers\n\n' +
        business
          .map(
            (name, i) =>
              '- [ ] 1.' +
              (i + 1) +
              ' Add the ' +
              name +
              ' acceptance marker.\n  **Acceptance:** ' +
              name +
              ' contains the exact approved marker followed by one newline.\n  **Requirements:** ' +
              capability +
              '#exact-markers\n',
          )
          .join('\n'),
      ['specs/' + capability + '/spec.md']:
        '# Acceptance markers\n\n## Purpose\n\nProvide machine-verifiable workflow acceptance markers in isolated repositories.\n\n## ADDED Requirements\n\n### Requirement: Exact markers\nEach selected repository MUST expose its approved diagnostic marker as exactly one line.\n\n#### Scenario: Evaluate acceptance markers\n- **WHEN** the Verify profile reads both selected repositories\n- **THEN** each marker file exactly matches the approved repository-specific line followed by a newline\n',
    };
    for (const [filename, text] of Object.entries(draft))
      fs.writeFileSync(path.join(spec, filename), text);
    cli('open-spec-validation', ['spec', 'validate', '--change', changeId]);
    commit(workspaceId, 'docs: define isolated workflow acceptance', [relative]);
    message =
      'Read the delivered Open Action and method. Confirmed the Store and both repositories; README files exist and the marker paths are unused. Created and strictly validated the four OpenSpec artifact types.';
  } else if (kind === 'specification.plan') {
    result = {
      schemaVersion: 1,
      kind: 'build-strategy-candidate',
      executionMode: 'autonomous',
      tddMode: 'tdd',
      rationale: {
        execution: {
          summary: 'Two bounded marker packages execute sequentially in this single managed Host.',
          refs: ['tasks.md'],
        },
        tdd: {
          summary:
            'Each marker has an executable exact-value check that fails before implementation.',
          refs: ['design.md'],
        },
      },
    };
    const relative = 'openspec/changes/' + changeId + '/design.md';
    const text =
      '\n## Verification and recovery\n\nUse independent marker packages with real RED/GREEN checks. Resume the same Run after the first completed package. Verify exact contents and recover a lost specification PR response.\n';
    fs.appendFileSync(path.join(workspace, relative), text);
    cli('design-spec-validation', ['spec', 'validate', '--change', changeId]);
    commit(workspaceId, 'docs: detail isolated Verify and Archive acceptance', [relative]);
    message =
      'Read the Design Action and method. Reviewed the exact Verify argv, file ownership and separate target branches. Documented independent packages, Verify checks, and cold recovery in the existing Design.';
  } else if (kind === 'build.configure') {
    result = {
      schemaVersion: 1,
      kind: 'execution-binding-candidate',
      strategyDigest: input.build.strategy.semanticDigest,
    };
    message =
      'Confirmed each of the three isolated repositories is attached to the same published source branch with the approved target; use the Runtime strategy.';
    for (const name of names) {
      assert.equal(git(name, 'branch', '--show-current'), branch);
      assert.equal(git(name, 'rev-parse', '@{upstream}'), git(name, 'rev-parse', 'HEAD'));
    }
  } else if (kind === 'build.plan') {
    assert.equal(input.tasks.length, 2);
    result = {
      schemaVersion: 1,
      kind: 'build-plan-candidate',
      packages: input.tasks.map((task, i) => {
        const name = business[i];
        return {
          packageKey: name,
          taskIds: [task.taskId],
          repositoryIds: name === readConsumer ? [name, observer] : [name],
          writeScopes: [{ repositoryId: name, paths: [markerPath] }],
          acceptanceRefs: task.acceptanceCriteria.map((x) => x.acceptanceId),
          expectedOutcomes: [name + ' diagnostic marker'],
          validatorProfile: 'build.package-valid',
          dependsOn: [],
          sideEffectClass: 'repository-write',
          completionContract: {
            schemaVersion: 1,
            behaviorSlice: name + '-marker',
            requiredEvidence: ['acceptance', 'implementation', 'red', 'green', 'regression'],
          },
        };
      }),
    };
    message =
      'Planned two independent repository-scoped packages from the approved tasks. Confirmed visibility of both exact machine checks and recorded one write scope per task.';
  } else if (kind === 'build.execute') {
    const selected = input.build.currentPackage;
    const [name] = selected.repositoryIds;
    assert(business.includes(name));
    const before = git(name, 'rev-parse', 'HEAD');
    if (driftScenario === 'future-backend' && name === 'web-front') {
      assert.equal(input.build.packageCompletions.length, 0);
      const previousHead = git('backend', 'rev-parse', 'HEAD');
      fs.writeFileSync(
        path.join(repository('backend'), externalPath),
        'independent backend work\n',
      );
      git('backend', 'add', '--', externalPath);
      git('backend', 'commit', '--no-gpg-sign', '-m', 'docs: independent backend change');
      const head = git('backend', 'rev-parse', 'HEAD');
      git('backend', 'push', 'origin', head + ':refs/heads/' + target);
      write('future-backend-drift', { activePackage: selected.packageId, previousHead, head });
    }
    if (
      driftScenario === 'active-read-input' &&
      name === readConsumer &&
      !exists('stale-execute')
    ) {
      observeOutsideChange();
      const stopped = pull('resume').result;
      assert.equal(stopped.state.reconciliationRequired, false);
      assert.equal(lifecycle(stopped).currentWork.workId, claim.packet.work.workId);
      write('stale-execute', {
        originalWorkId: claim.packet.work.workId,
        invocation: claim.invocation.invocationId,
      });
      return submit(
        claim,
        null,
        'Read input advanced during this invocation. No repository writes occurred.',
        'failed',
      );
    }
    if (name === readConsumer) {
      const observedPath = path.join(repository(observer), externalPath);
      const current = fs.existsSync(observedPath);
      const bytes = fs.readFileSync(
        current ? observedPath : path.join(repository(observer), 'README.md'),
        'utf8',
      );
      assert.equal(bytes, current ? 'frontend team sync\n' : '# ' + observer + '\n');
      log('used-read-input.jsonl', { packageId: selected.packageId, hash: hash(bytes), current });
    }
    if (input.build.revalidateCompletion) {
      const previous = input.build.revalidateCompletion;
      assert.equal(driftScenario, 'completed-read-input');
      assert.equal(previous.packageId, selected.packageId);
      const green = check(name, 0);
      const regression = check(name, 0);
      assert.equal(git(name, 'rev-parse', 'HEAD'), before);
      assert.equal(git(name, 'status', '--porcelain'), '');
      const invocation = claim.invocation.invocationId;
      result = {
        schemaVersion: 1,
        kind: 'build-package-completion',
        packageId: selected.packageId,
        acceptanceEvidenceIds: [invocation + '-green'],
        testEvidenceIds: [invocation + '-regression'],
        tddEvidence: {
          redEvidenceId: previous.tddEvidence.redEvidenceId,
          greenEvidenceId: invocation + '-green',
          regressionEvidenceId: invocation + '-regression',
        },
        implementationDigest: hash(fs.readFileSync(path.join(repository(name), markerPath))),
      };
      write('input-revalidation', {
        packageId: selected.packageId,
        previous,
        result,
        unchangedHead: before,
        green: { pid: green.pid, code: green.status },
        regression: { pid: regression.pid, code: regression.status },
      });
      return submit(
        claim,
        result,
        'Revalidated the affected package with fresh GREEN and regression on the new read input.',
      );
    }
    const red = check(name, 1);
    const absolute = path.join(repository(name), markerPath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, markers[name] + '\n');
    const green = check(name, 0);
    const regression = check(name, 0);
    const after = commit(name, 'docs: add isolated acceptance marker', [markerPath]);
    const invocation = claim.invocation.invocationId;
    const recorded = {
      repository: name,
      invocation,
      before,
      after,
      red: { pid: red.pid, code: red.status },
      green: { pid: green.pid, code: green.status },
      regression: { pid: regression.pid, code: regression.status },
    };
    log('package-executions.jsonl', recorded);
    result = {
      schemaVersion: 1,
      kind: 'build-package-completion',
      packageId: selected.packageId,
      acceptanceEvidenceIds: [invocation + '-green'],
      testEvidenceIds: [invocation + '-regression'],
      tddEvidence: {
        redEvidenceId: invocation + '-red',
        greenEvidenceId: invocation + '-green',
        regressionEvidenceId: invocation + '-regression',
      },
      implementationDigest: hash(fs.readFileSync(absolute)),
    };
    message =
      'Executed the assigned package only. Real RED=1, GREEN=0 and regression=0, then pushed the checked commit. ' +
      'Checks used the precise approved marker.';
  } else if (kind === 'build.check' || kind === 'evidence.verify') {
    assert.equal(input.build.packageCompletions.length, 2);
    const records = fs
      .readFileSync(path.join(evidence, 'package-executions.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(JSON.parse);
    const inspected = business.map((name) => {
      const entry = records.findLast((record) => record.repository === name);
      assert.equal(git(name, 'rev-parse', 'HEAD'), entry.after);
      assert.equal(git(name, 'diff', '--name-only', entry.before, entry.after), markerPath);
      assert.equal(git(name, 'diff', '--check', entry.before, entry.after), '');
      assert.equal(git(name, 'status', '--porcelain'), '');
      const content = fs.readFileSync(path.join(repository(name), markerPath), 'utf8');
      assert(content.startsWith(markers[name] + '\n'));
      assert.equal(content, markers[name] + '\n');
      return { name, head: entry.after, digest: hash(content) };
    });
    write('review-' + l.checkEpoch, {
      inspected,
      invocationId: claim.invocation.invocationId,
      kind,
    });
    if (kind === 'build.check') {
      result = {
        schemaVersion: 1,
        kind: 'build-check-candidate',
        completedPackageIds: input.build.plan.packages.map((p) => p.packageId),
        acceptedTaskIds: input.tasks.map((task) => task.taskId),
        testEvidenceIds: input.build.packageCompletions.flatMap((c) => c.testEvidenceIds),
        implementationDigest: hash(JSON.stringify(inspected)),
        reviewerExecutionId: claim.invocation.invocationId,
      };
    } else
      cli('verify-spec-validation-' + l.checkEpoch, ['spec', 'validate', '--change', changeId]);
    message =
      'Reviewed actual Git diffs, exact scopes, clean heads, and current task/completion identities. ' +
      'Machine evidence remains the authority for acceptance.';
  } else if (kind === 'specification.close' || kind === 'delivery.publish') {
    const archive = input.archiveDeliveryInput;
    assert(archive && archive.changeId === changeId);
    assert.equal(archive.changeBranch.targetBranch, target);
    assert.deepEqual(
      archive.businessDeliveries.map((delivery) => delivery.repositoryId).sort(),
      [...business].sort(),
    );
    assert(
      archive.businessDeliveries.every(
        (delivery) => delivery.sourceBranch === branch && delivery.targetBranch === target,
      ),
    );
    assert.equal(archive.changeBranch.remoteOid, git(workspaceId, 'rev-parse', 'HEAD'));
    for (const name of names) assert.equal(git(name, 'status', '--porcelain'), '');
    message =
      kind === 'specification.close'
        ? 'Reviewed the accepted Verify evidence and current Archive packet. The Provider may close the approved Change in the isolated checkout using the frozen publication coordinates.'
        : 'Reviewed the executed specification Closure and the published source OIDs. Deliver two business PRs and one specification PR on the approved isolated target branches.';
  } else throw new Error('Unsupported Work ' + kind);
  return submit(claim, result, message);
}

function snapshot(view) {
  const current = lifecycle(view);
  return {
    runId: view.state.runId,
    phase: current.phase,
    status: view.state.status,
    planId: current.buildProtocol?.plan?.planId,
    completions: current.buildProtocol?.packageCompletions,
    checkpoint: current.buildProtocol?.workspaceCheckpoint,
    workId: current.currentWork?.workId,
    checkEpoch: current.checkEpoch,
    attempt: view.changeLifecycle.evidence.latestAttemptId,
    bundleIds: view.state.acceptedEvidenceBundleIds,
    gate: view.changeLifecycle.evidence.gateStatus,
  };
}
const records = (name) =>
  fs.existsSync(path.join(evidence, name))
    ? fs
        .readFileSync(path.join(evidence, name), 'utf8')
        .trim()
        .split(/\r?\n/u)
        .filter(Boolean)
        .map(JSON.parse)
    : [];
const writes = () =>
  records('requests.jsonl').filter(
    (item) =>
      item.method === 'POST' && (item.service === 'api' || item.route === 'git-receive-pack'),
  );
const pulls = () => JSON.parse(fs.readFileSync(path.join(evidence, 'pulls.json'), 'utf8'));

function prepareArchive() {
  const accepted = snapshot(status());
  assert.equal(accepted.gate, 'satisfied');
  write('accepted-verify', accepted);
  const task = 'openspec/changes/' + changeId + '/tasks.md';
  if (git(workspaceId, 'diff', '--name-only') === task) {
    const normalize = (text) =>
      text
        .trim()
        .replaceAll('\r\n', '\n')
        .replace(/^(\s*-\s*)\[[xX ]\]/gmu, '$1[ ]');
    assert.equal(
      normalize(git(workspaceId, 'show', 'HEAD:' + task)),
      normalize(fs.readFileSync(path.join(workspace, task), 'utf8')),
    );
    commit(workspaceId, 'docs: record task completion', [task]);
  }
  const resumed = snapshot(pull('resume').result);
  for (const key of [
    'runId',
    'phase',
    'status',
    'planId',
    'completions',
    'attempt',
    'bundleIds',
    'gate',
  ]) {
    assert.deepEqual(resumed[key], accepted[key], key);
  }
  const oid = git(workspaceId, 'rev-parse', 'HEAD');
  const intent = {
    schemaVersion: 3,
    changeId,
    changeBranch: {
      repositoryId: workspaceId,
      remoteIdentity: remoteHost + '/acceptance/' + workspaceId,
      sourceBranch: branch,
      targetBranch: target,
      remoteOid: oid,
    },
    businessDeliveries: business.map((repositoryId) => ({
      deliveryId: repositoryId,
      repositoryId,
      sourceBranch: branch,
      targetBranch: target,
      commitMessage: 'docs: acceptance marker',
      actions: ['push', 'merge_request'],
    })),
    businessSplitReason: {
      kind: 'multi_repository',
      summary: 'Independent markers in two repositories.',
    },
  };
  if (driftScenario === 'external-commit') {
    const before = writes();
    const unauthorized = {
      ...intent,
      businessDeliveries: [
        ...intent.businessDeliveries,
        {
          deliveryId: observer,
          repositoryId: observer,
          sourceBranch: branch,
          targetBranch: target,
          commitMessage: 'docs: separate backend work',
          actions: ['push', 'merge_request'],
        },
      ],
    };
    const response = cli(
      'archive-outside-scope',
      [
        'run',
        'archive-prepare',
        '--run',
        state.runId,
        '--evidence-attempt',
        accepted.attempt,
        '--intent',
        write('outside-publication-intent', unauthorized),
      ],
      false,
    );
    assert.match(JSON.stringify(response.diagnostics), /unaccepted Business revision/u);
    assert.deepEqual(
      writes(),
      before,
      'Invalid Archive intent must have no publication side effects',
    );
    assert.equal(lifecycle(status()).currentWork, null);
  }
  cli('archive-prepare', [
    'run',
    'archive-prepare',
    '--run',
    state.runId,
    '--evidence-attempt',
    accepted.attempt,
    '--intent',
    write('intent', intent),
  ]);
  write('archive-write-baseline', writes());
}

function publish() {
  return pull('archive-publish', '--work-attempt', '1').result.value;
}
function recoverPublication() {
  const baseline = writes();
  const argv = [
    entry,
    'run',
    'archive-publish',
    '--run',
    state.runId,
    '--work-attempt',
    '1',
    '--workspace',
    workspace,
    '--json',
  ];
  const lost = run(process.execPath, argv, workspace, [0, 1, 2]);
  write('lost-response', { exit: lost.status, stdout: lost.stdout, stderr: lost.stderr });
  const unknown = status();
  assert.equal(unknown.state.workExecution.continuation, 'reconcile');
  assert.equal(pulls().length, 3);
  assert(records('requests.jsonl').some((item) => item.service === 'fault'));
  const afterCreate = writes();
  const created = pulls();
  assert.equal(
    afterCreate.slice(baseline.length).filter((item) => item.service === 'api').length,
    3,
  );
  for (const mode of ['resume', 'next']) {
    const view = pull(mode).result;
    assert.equal(view.state.runId, state.runId);
    assert.equal(view.state.workExecution.continuation, 'reconcile');
    assert.deepEqual(
      view.state.workExecution.hostInvocation,
      unknown.state.workExecution.hostInvocation,
    );
  }
  run(process.execPath, argv, workspace, [0, 1, 2]);
  assert.deepEqual(writes(), afterCreate);
  fs.writeFileSync(path.join(root, 'reveal-pr'), 'visible\n');
  const accepted = publish();
  assert.equal(accepted.run.state.status, 'completed');
  assert.deepEqual(pulls(), created);
  assert.deepEqual(writes(), afterCreate);
  assert.deepEqual(accepted.receipt.evidenceBundleIds, snapshot(unknown).bundleIds);
  const spec = accepted.receipt.items.find((item) => item.role === 'specification');
  assert.equal(spec.provenance, 'recovered');
  write('published-receipt', accepted.receipt);
  write('publication-recovery', {
    runId: state.runId,
    invocation: unknown.state.workExecution.hostInvocation,
    writesBefore: baseline,
    writesAfterCreate: afterCreate,
    writesAfterRecovery: writes(),
    adoptedPR: spec.mergeRequest,
    createdPRs: created,
  });
}

function recordsAtTrajectory() {
  return fs
    .readFileSync(
      path.join(workspace, '.repoctopus', 'runs', state.runId, 'trajectory.jsonl'),
      'utf8',
    )
    .trim()
    .split(/\r?\n/u)
    .map(JSON.parse);
}

function verifyTerminal() {
  assert.deepEqual(
    records('skills.jsonl').map((item) => item.kind),
    [
      'change.intake',
      'specification.plan',
      'build.configure',
      'build.plan',
      'build.execute',
      'build.execute',
      ...(['active-read-input', 'completed-read-input'].includes(driftScenario)
        ? ['build.execute']
        : []),
      'build.check',
      'evidence.verify',
      'specification.close',
      'delivery.publish',
    ],
    'Expected the complete approved workflow without skipped or repeated Work',
  );
  assert.deepEqual(
    records('decisions.jsonl').map((item) => item.kind),
    expectedDecisions,
  );
  if (driftScenario === 'active-read-input') {
    const stale = read('stale-execute');
    const rejected = recordsAtTrajectory().find((item) =>
      JSON.stringify(item).includes('workspace-read-input-stale'),
    );
    assert(rejected, 'The stale invocation must have an attributable, durable rejection');
    assert(JSON.stringify(rejected).includes(stale.invocation));
  }
  if (driftScenario === 'completed-read-input') {
    const verification = read('input-revalidation');
    assert.equal(
      verification.previous.tddEvidence.redEvidenceId,
      verification.result.tddEvidence.redEvidenceId,
    );
    assert.notEqual(
      verification.previous.tddEvidence.greenEvidenceId,
      verification.result.tddEvidence.greenEvidenceId,
    );
  }
  const receipt = read('published-receipt');
  assert.equal(receipt.items.length, 3);
  for (const item of receipt.items) {
    const matches = pulls().filter(
      (pr) =>
        pr.repository === item.repositoryId &&
        pr.head.ref === item.sourceBranch &&
        pr.base.ref === item.targetBranch,
    );
    assert.equal(matches.length, 1);
    assert.equal(matches[0].number, item.mergeRequest.number);
    assert.equal(matches[0].head.sha, item.publishedOid);
    if (driftScenario && item.role === 'business') {
      const base = git(
        item.repositoryId,
        'ls-remote',
        '--heads',
        'origin',
        'refs/heads/' + item.targetBranch,
      ).split(/\s/u)[0];
      const diff = git(item.repositoryId, 'diff', '--name-only', base + '...' + item.publishedOid);
      assert.equal(diff, markerPath);
      if (observer) assert(!pulls().some((pr) => pr.repository === observer));
      log('publication-diffs.jsonl', {
        repositoryId: item.repositoryId,
        base,
        head: item.publishedOid,
        diff,
      });
    }
    assert.equal(
      git(
        item.repositoryId,
        'ls-remote',
        '--heads',
        'origin',
        'refs/heads/' + item.sourceBranch,
      ).split(/\s/u)[0],
      item.publishedOid,
    );
  }
  const before = status();
  assert.equal(before.state.status, 'completed');
  const runRoot = path.join(workspace, '.repoctopus', 'runs', state.runId);
  const durable = () =>
    Object.fromEntries(
      ['run.json', 'checkpoint.json', 'trajectory.jsonl'].map((name) => [
        name,
        hash(fs.readFileSync(path.join(runRoot, name))),
      ]),
    );
  const hashes = durable();
  const effects = writes();
  for (const action of ['resume', 'next', 'next', 'resume']) {
    const response = pull(action);
    assert.deepEqual(response.result.state, before.state);
    assert.equal(response.result.continuation.continuation, 'done');
    assert.deepEqual(response.nextActions, []);
    assert.deepEqual(durable(), hashes);
    assert.deepEqual(writes(), effects);
  }
  for (const name of business) {
    assert.equal(
      records('package-executions.jsonl').filter((item) => item.repository === name).length,
      1,
    );
    assert.equal(
      records('verify-commands.jsonl').filter((item) => item.repository === name).length,
      1,
    );
  }
  const spec = receipt.items.find((item) => item.role === 'specification');
  const tree = git(workspaceId, 'ls-tree', '-r', '--name-only', spec.publishedOid).split(/\r?\n/u);
  assert.equal(
    tree.filter((name) => name.startsWith('openspec/changes/archive/') && name.includes(changeId))
      .length,
    4,
  );
  assert(tree.includes('openspec/specs/' + changeId + '-markers/spec.md'));
  const effectsAfterPrepare = effects.slice(read('archive-write-baseline').length);
  assert.equal(effectsAfterPrepare.filter((item) => item.service === 'api').length, 3);
  assert.deepEqual(
    effectsAfterPrepare.filter((item) => item.service === 'git').map((item) => item.repository),
    ['workspace'],
  );
  return write('terminal', { runId: state.runId, status: 'completed', hashes, receipt });
}

function inspectPacket(claim) {
  assert(claim.executionAcquired);
  const layers = claim.packet.context.layers.filter((layer) =>
    ['action-skill', 'augmentation-skill'].includes(layer.kind),
  );
  assert(layers.some((layer) => layer.kind === 'action-skill'));
  for (const layer of layers) assert(layer.content.trim().length > 60);
  const kind = claim.packet.work.kind;
  const method = {
    'change.intake': 'grilling',
    'specification.plan': 'codebase-design',
    'build.execute': 'tdd',
    'evidence.verify': 'code-review',
  }[kind];
  if (method) assert(layers.some((layer) => layer.source === method));
  log('skills.jsonl', {
    kind,
    invocation: claim.invocation.invocationId,
    layers: layers.map((layer) => ({ source: layer.source, digest: layer.digest })),
  });
}

function observeOutsideChange() {
  const previousHead = git(observer, 'rev-parse', 'HEAD');
  if (driftScenario !== 'external-commit') {
    const sibling = path.join(root, 'another-team');
    git(observer, 'worktree', 'add', '-b', 'other-team', sibling, previousHead);
    fs.writeFileSync(path.join(sibling, externalPath), 'frontend team sync\n');
    run('git', ['add', '--', externalPath], sibling);
    run('git', ['commit', '--no-gpg-sign', '-m', 'docs: external team sync'], sibling);
    run('git', ['push', 'origin', 'HEAD:refs/heads/' + branch], sibling);
    git(observer, 'pull', '--ff-only', 'origin', branch);
  } else {
    fs.writeFileSync(path.join(repository(observer), externalPath), 'separate backend work\n');
    git(observer, 'add', '--', externalPath);
    git(observer, 'commit', '--no-gpg-sign', '-m', 'docs: separate backend change');
  }
  const head = git(observer, 'rev-parse', 'HEAD');
  assert.notEqual(head, previousHead);
  git(observer, 'merge-base', '--is-ancestor', previousHead, head);
  write('outside-package-change', {
    scenario: driftScenario,
    repositoryId: observer,
    previousHead,
    head,
  });
}

if (mode === 'first') {
  initialize();
  write('first-driver', { pid: process.pid, runId: state.runId });
} else {
  assert.equal(mode, 'finish');
  const before = read('cold-before');
  if (observer && driftScenario !== 'active-read-input') observeOutsideChange();
  const action = driftScenario === 'external-commit' ? 'next' : 'resume';
  const recoveredView = pull(action).result;
  assert.equal(
    recoveredView.state.reconciliationRequired,
    false,
    'A clean fast-forward should continue or reissue the dependent Work',
  );
  const recovered = snapshot(recoveredView);
  assert.equal(recovered.runId, before.runId);
  assert.equal(recovered.planId, before.planId);
  if (driftScenario === 'completed-read-input') {
    assert.equal(before.completions.length, 1, 'An original TDD completion must exist');
    assert.deepEqual(recovered.completions, []);
  } else {
    assert.deepEqual(recovered.completions, before.completions);
  }
  if (['read-input', 'completed-read-input'].includes(driftScenario)) {
    const changed = read('outside-package-change');
    const accepted = recovered.checkpoint.repositories.find(
      ({ repositoryId }) => repositoryId === observer,
    );
    assert.equal(accepted.externalInputHead, changed.head);
    assert.notEqual(recovered.workId, before.workId);
    assert.equal(recovered.checkEpoch, before.checkEpoch + 1);
    const protocol = lifecycle(recoveredView).buildProtocol;
    const affected = protocol.plan.packages.find((entry) => entry.repositoryIds.includes(observer));
    assert.deepEqual(protocol.invalidations.at(-1).affectedPackageIds, [affected.packageId]);
    assert.equal(protocol.invalidations.at(-1).source, 'workspace-input');
  } else {
    assert.deepEqual(recovered.checkpoint, before.checkpoint);
    assert.equal(recovered.workId, before.workId);
    assert.equal(recovered.checkEpoch, before.checkEpoch);
  }
  assert.notEqual(process.pid, read('first-driver').pid);
  write('cold-recovery', {
    before,
    recovered,
    firstPID: read('first-driver').pid,
    secondPID: process.pid,
  });
}
let reachedBoundary = false;
for (let step = 0; step < 40; step++) {
  const view = pull('next').result;
  const current = lifecycle(view);
  process.stdout.write(
    JSON.stringify({
      phase: current.phase,
      status: view.state.status,
      work: current.currentWork?.kind,
      completions: current.buildProtocol?.packageCompletions.length,
    }) + '\n',
  );
  if (view.state.status === 'completed') {
    verifyTerminal();
    reachedBoundary = true;
    break;
  }
  if (view.state.status === 'waiting') {
    const decision = pull('decision').result;
    assert(
      expectedDecisions.includes(decision.decisionKind),
      'Unexpected human decision: ' + decision.decisionKind,
    );
    assert(
      !records('decisions.jsonl').some((item) => item.kind === decision.decisionKind),
      'Repeated human decision: ' + decision.decisionKind,
    );
    const response = {
      ...decision.responseTemplate,
      decision: 'approve',
      ...(decision.decisionKind === 'specification-open' ? { isolation: 'branch' } : {}),
      interaction: {
        channel: 'conversation',
        authorization: 'delegated',
        reference: 'Isolated automated package acceptance fixture',
      },
    };
    pull('decide', '--response-file', write('decision-response', response));
    log('decisions.jsonl', { kind: decision.decisionKind, requestId: decision.requestId });
    continue;
  }
  if (current.phase === 'archive' && !current.currentWork) {
    prepareArchive();
    continue;
  }
  if (
    mode === 'first' &&
    current.currentWork?.kind === 'build.execute' &&
    current.buildProtocol.packageCompletions.length === 1
  ) {
    const boundary = snapshot(view);
    if (driftScenario === 'future-backend') {
      const external = read('future-backend-drift');
      const accepted = boundary.checkpoint.repositories.find(
        ({ repositoryId }) => repositoryId === 'backend',
      );
      assert.equal(accepted.externalInputHead, external.head);
      assert.equal(boundary.completions[0].packageId, external.activePackage);
    }
    write('cold-before', boundary);
    reachedBoundary = true;
    break;
  }
  const claim = claimCurrent();
  inspectPacket(claim);
  build(claim);
  if (current.currentWork.kind === 'specification.close') {
    assert.equal(publish().stage, 'specification-closed');
  }
  if (current.currentWork.kind === 'delivery.publish') recoverPublication();
}
assert(reachedBoundary, 'Workflow exceeded the bounded action budget');
