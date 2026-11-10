import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Test operator: installed public CLI, ordinary repository edits, no Runtime Store writes.
const [rootArg, cliArg, stage = 'status'] = process.argv.slice(2);
assert(rootArg && cliArg, 'Usage: node acceptance.mjs <fresh-lab-root> <installed-cli> <stage>');
const root = path.resolve(rootArg),
  cliFile = path.resolve(cliArg);
const workspace = path.join(root, 'workspace'),
  evidence = path.join(root, 'evidence');
const changeId = 'verify-selective-repair',
  names = ['a', 'b', 'c', 'd'];
const branch = `change/${changeId}`;
fs.mkdirSync(evidence, { recursive: true });
const env = {
  ...process.env,
  XDG_DATA_HOME: path.join(root, 'xdg-data'),
  XDG_CONFIG_HOME: path.join(root, 'xdg-config'),
  OPENSPEC_NO_UPDATE_CHECK: '1',
  OPENSPEC_TELEMETRY: '0',
  REPOCTOPUS_DESKTOP_EXECUTABLE: process.execPath,
};
const file = (name) => path.join(evidence, `${name}.json`);
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/u, ''));
const write = (p, value) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n');
};
const hash = (x) =>
  `sha256:${createHash('sha256')
    .update(typeof x === 'string' ? x : JSON.stringify(x))
    .digest('hex')}`;
const state = fs.existsSync(file('operator')) ? read(file('operator')) : {};
function command(label, program, args, cwd = workspace, expected = 0, interactive = false) {
  const result = spawnSync(program, args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...(interactive ? { stdio: 'inherit' } : {}),
  });
  const record = {
    label,
    program,
    args,
    cwd,
    exitCode: result.status,
    error: result.error?.message,
    stdout: result.stdout,
    stderr: result.stderr,
    at: new Date().toISOString(),
  };
  fs.appendFileSync(path.join(evidence, 'commands.jsonl'), JSON.stringify(record) + '\n');
  assert.equal(
    result.status,
    expected,
    `${label}: ${result.stderr ?? result.error ?? result.stdout}`,
  );
  return result.stdout;
}
const git = (repo, args) => command(`git-${repo}-${args[0]}`, 'git', args, path.join(root, repo));
function commit(repo, message) {
  git(repo, ['add', '.']);
  if (!git(repo, ['status', '--porcelain']).trim()) return;
  git(repo, ['commit', '-m', message]);
  git(repo, ['push']);
}
function cli(label, args, interactive = false) {
  const text = command(
    label,
    process.execPath,
    [cliFile, ...args, '--workspace', workspace, ...(interactive ? [] : ['--json'])],
    workspace,
    0,
    interactive,
  );
  if (interactive) return;
  const result = JSON.parse(text);
  write(file(label), result);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return result;
}
const run = (label, action) => cli(label, ['run', action, '--run', state.runId]);
const current = () => run('status', 'status').result;
const life = (view) => view.state.changeLifecycle;
function summarize(view) {
  const l = life(view),
    p = l.buildProtocol;
  return {
    runId: state.runId,
    phase: l.phase,
    status: view.state.status,
    reconciliationRequired: view.state.reconciliationRequired,
    epoch: l.checkEpoch,
    kind: l.currentWork?.kind,
    workId: l.currentWork?.workId,
    planId: p?.plan?.planId,
    completions: p?.packageCompletions.map((c) => c.completionId),
    affected: p?.verifyRepair?.scope.affectedPackageIds,
    retained: p?.verifyRepair?.retained.map((r) => r.completionId),
    continuation: view.continuation,
  };
}
function check(repo, strict, label, expected) {
  return command(
    label,
    process.execPath,
    [
      '-e',
      `const fs=require('node:fs'),assert=require('node:assert/strict');const v=fs.readFileSync('src/value.txt','utf8');assert(${strict ? "v==='ready\\n'" : 'v.length>0'});`,
    ],
    path.join(root, repo),
    expected,
  );
}

if (stage === 'init' || stage === 'init-recover') {
  assert(!state.runId, 'Initialization cannot replace an active Run');
  if (stage === 'init') assert(!fs.existsSync(path.join(workspace, '.git')), 'Fresh root required');
  for (const name of stage === 'init' ? ['workspace', ...names] : []) {
    const repo = path.join(root, name),
      remote = path.join(root, `${name}.git`);
    fs.mkdirSync(repo, { recursive: true });
    fs.mkdirSync(remote);
    command('bare-init', 'git', ['init', '--bare', '--initial-branch=main'], remote);
    command('repo-init', 'git', ['init', '--initial-branch=main'], repo);
    git(name, ['config', 'user.name', 'Repoctopus Acceptance']);
    git(name, ['config', 'user.email', 'acceptance@example.invalid']);
    fs.writeFileSync(path.join(repo, 'README.md'), `# ${name}\n`);
    git(name, ['add', '.']);
    git(name, ['commit', '-m', 'test: establish acceptance baseline']);
    git(name, ['remote', 'add', 'origin', `../${name}.git`]);
    git(name, ['push', '-u', 'origin', 'main']);
    git(name, ['switch', '-c', branch]);
    git(name, ['push', '-u', 'origin', branch]);
  }
  const openspec = path.resolve(
    path.dirname(cliFile),
    '../../@fission-ai/openspec/bin/openspec.js',
  );
  command('openspec-init', process.execPath, [
    openspec,
    'init',
    workspace,
    '--tools',
    'none',
    '--no-animation',
    '--no-copilot-cloud',
  ]);
  command('openspec-store-setup', process.execPath, [
    openspec,
    'store',
    'setup',
    'verify-selective-repair',
    '--path',
    workspace,
    '--no-init-git',
    '--json',
  ]);
  fs.writeFileSync(path.join(workspace, '.gitignore'), '.repoctopus/\n');
  const nodes = names.map((name, i) => ({
    id: `check-${name}`,
    type: 'command',
    repository: name,
    dependsOn: [],
    required: true,
    covers: [`task:1.${i + 1}`],
    executable: process.execPath,
    timeoutMs: 30000,
    cache: true,
    cacheTtlMs: 3600000,
    args: [
      '-e',
      `const fs=require('node:fs'),assert=require('node:assert/strict');fs.appendFileSync(${JSON.stringify(path.join(evidence, 'node-calls.jsonl'))},JSON.stringify({node:${JSON.stringify(name)},pid:process.pid})+'\\n');assert.equal(fs.readFileSync('src/value.txt','utf8'),'ready\\n');`,
    ],
    inputs: {
      schemaVersion: 1,
      repositories: [{ repository: name, files: ['src/value.txt'], outputs: [] }],
      git: 'none',
      env: [],
      taskCheckboxes: 'ignore',
    },
  }));
  const config = {
    apiVersion: 'repoctopus/v1alpha1',
    kind: 'RepoctopusWorkspace',
    workspace: { id: 'verify-selective-repair', repositoryId: 'workspace' },
    repositories: ['workspace', ...names].map((id) => ({
      id,
      path: id === 'workspace' ? '.' : `../${id}`,
    })),
    profiles: [{ id: 'verify', nodes }],
    specificationProvider: {
      id: 'specification-openspec',
      store: { id: 'verify-selective-repair', repositoryId: 'workspace' },
    },
  };
  write(path.join(workspace, 'repoctopus.yaml'), config);
  commit('workspace', 'test: configure independent machine coverage');
  write(file('candidate'), {
    cli: cliFile,
    installedManifest: hash(
      fs.readFileSync(path.join(path.dirname(cliFile), '../dist/repoctopus.mjs'), 'utf8'),
    ),
  });
} else if (stage === 'start') {
  assert(!state.runId);
  const result = cli('start', [
    'run',
    'start',
    '--change',
    changeId,
    '--target',
    'main',
    '--execution-mode',
    'autonomous',
    '--tdd-mode',
    'tdd',
  ]);
  state.runId = result.runId;
  write(file('operator'), state);
  console.log(JSON.stringify(summarize(result.result)));
} else if (stage === 'auto-build') {
  for (let step = 0; step < 24; step++) {
    const view = current(),
      l = life(view);
    console.log(JSON.stringify(summarize(view)));
    if (l.phase !== 'build' || view.state.status !== 'running') break;
    const continuation = view.continuation?.continuation;
    if (continuation === 'ask' || continuation === 'reobserve' || continuation === 'reconcile')
      break;
    const execution = view.state.workExecution;
    const action =
      execution && ['submitted', 'outcome', 'validated'].includes(execution.status)
        ? 'next'
        : 'work';
    command(
      `operator-${action}`,
      process.execPath,
      [process.argv[1], root, cliFile, action],
      path.resolve('.'),
    );
  }
} else if (stage === 'decide') {
  cli('decide', ['run', 'decide', '--run', state.runId], true);
} else if (stage === 'work') {
  const view = current(),
    l = life(view),
    kind = l.currentWork?.kind;
  assert(kind);
  const claim = cli(`claim-${Date.now()}`, [
    'run',
    'work-claim',
    '--run',
    state.runId,
    '--adapter',
    'manual',
    '--runner',
    'codex:verify-selective-repair',
    '--host-capabilities',
    'build.autonomous,evidence.write,git.publish,process.execute,repository.read,repository.write,specification.read,specification.write',
  ]).result;
  assert(claim.packet && claim.invocation);
  for (const layer of claim.packet.context.layers) assert.equal(typeof layer.content, 'string');
  write(file(`packet-${claim.invocation.invocationId}`), claim.packet);
  const input = JSON.parse(
    claim.packet.context.layers.find((x) => x.kind === 'change-inputs').content,
  );
  let result;
  if (kind === 'change.intake' || kind === 'specification.plan') {
    const dir = path.join(workspace, 'openspec', 'changes', changeId);
    fs.mkdirSync(path.join(dir, 'specs', 'repair-acceptance'), { recursive: true });
    if (kind === 'change.intake') {
      fs.writeFileSync(
        path.join(dir, 'proposal.md'),
        '# Proposal\n\n## Why\n\nProve selective repair through the installed CLI.\n\n## What Changes\n\n- Add four independent test outputs.\n\n## Capabilities\n\n### New Capabilities\n\n- `repair-acceptance`: four independently verified outputs.\n\n## Impact\n\n- Isolated test repositories only.\n',
      );
      fs.writeFileSync(
        path.join(dir, 'design.md'),
        '# Design\n\n## Context\n\nFive local Git repositories and four independent machine checks.\n\n## Goals / Non-Goals\n\nRetain valid completions during implementation repair; no publication.\n\n## Decisions\n\nUse branch isolation, real TDD and explicit per-repository machine inputs. Package A initially passes presence-only unit tests; strict Verify detects its wrong value. Repair only A and recheck retained B/C/D.\n',
      );
      fs.writeFileSync(
        path.join(dir, 'tasks.md'),
        '# Tasks\n\n' +
          names
            .map(
              (name, i) =>
                `- [ ] 1.${i + 1} Implement output ${name}.\n  **Acceptance:** output ${name} equals ready\n  **Requirements:** repair-acceptance#independent-output\n`,
            )
            .join(''),
      );
      fs.writeFileSync(
        path.join(dir, 'specs', 'repair-acceptance', 'spec.md'),
        '# Repair Acceptance\n\n## Purpose\n\nVerify independent package outputs.\n\n## ADDED Requirements\n\n### Requirement: Independent output\n\nEach output MUST contain ready.\n\n#### Scenario: Four outputs\n\n- **WHEN** the four packages execute\n- **THEN** every machine check reads ready\n',
      );
    } else
      fs.appendFileSync(
        path.join(dir, 'design.md'),
        '\n## Recovery checkpoints\n\nExit and resume after the failed Gate, repair Plan acceptance, repaired package and Check. Compare original B/C/D completion IDs and Plan identity. Reject unauthorized branch and preserve failed Gate history.\n',
      );
    commit('workspace', `docs: record ${kind}`);
  } else if (kind === 'build.configure')
    result = {
      schemaVersion: 1,
      kind: 'execution-binding-candidate',
      strategyDigest: input.build.strategy.semanticDigest,
    };
  else if (kind === 'build.plan')
    result = {
      schemaVersion: 1,
      kind: 'build-plan-candidate',
      packages: input.tasks.map((task, i) => ({
        packageKey: names[i],
        taskIds: [task.taskId],
        repositoryIds: [names[i]],
        writeScopes: [{ repositoryId: names[i], paths: ['src/value.txt'] }],
        acceptanceRefs: task.acceptanceCriteria.map((x) => x.acceptanceId),
        expectedOutcomes: ['ready output'],
        validatorProfile: 'build.package-valid',
        dependsOn: [],
        sideEffectClass: 'repository-write',
        completionContract: {
          schemaVersion: 1,
          behaviorSlice: `output-${names[i]}`,
          requiredEvidence: ['acceptance', 'implementation', 'red', 'green', 'regression'],
        },
      })),
    };
  else if (kind === 'build.execute') {
    const p = input.build.currentPackage,
      repo = p.repositoryIds[0],
      repairing = !!input.build.verifyRepair;
    const prefix = `${claim.invocation.invocationId}`;
    check(repo, repairing, `${prefix}-red`, 1);
    fs.mkdirSync(path.join(root, repo, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(root, repo, 'src/value.txt'),
      repo === 'a' && !repairing ? 'unit-only\n' : 'ready\n',
    );
    check(repo, repairing, `${prefix}-green`, 0);
    check(repo, repairing, `${prefix}-regression`, 0);
    commit(repo, `fix: complete ${repo} output`);
    result = {
      schemaVersion: 1,
      kind: 'build-package-completion',
      packageId: p.packageId,
      acceptanceEvidenceIds: [`${prefix}-green`],
      testEvidenceIds: [`${prefix}-regression`],
      tddEvidence: {
        redEvidenceId: `${prefix}-red`,
        greenEvidenceId: `${prefix}-green`,
        regressionEvidenceId: `${prefix}-regression`,
      },
      implementationDigest: hash(fs.readFileSync(path.join(root, repo, 'src/value.txt'), 'utf8')),
    };
    fs.appendFileSync(
      path.join(evidence, 'execute-calls.jsonl'),
      JSON.stringify({ repo, repairing, invocationId: prefix, packageId: p.packageId }) + '\n',
    );
  } else if (kind === 'build.check') {
    result = {
      schemaVersion: 1,
      kind: 'build-check-candidate',
      completedPackageIds: input.build.plan.packages.map((p) => p.packageId),
      acceptedTaskIds: input.tasks.map((t) => t.taskId),
      testEvidenceIds: input.build.packageCompletions.flatMap((c) => c.testEvidenceIds),
      implementationDigest: hash(input.build.packageCompletions),
      reviewerExecutionId: claim.invocation.invocationId,
    };
  } else assert.equal(kind, 'evidence.verify');
  const resultFile = file(`result-${claim.invocation.invocationId}`);
  if (result) write(resultFile, result);
  cli(`outcome-${claim.invocation.invocationId}`, [
    'run',
    'work-outcome',
    '--run',
    state.runId,
    '--submission-id',
    `${claim.invocation.invocationId}:1`,
    '--invocation-id',
    claim.invocation.invocationId,
    '--host-id',
    claim.invocation.host.id,
    '--packet-digest',
    claim.packet.identity.packetDigest,
    '--status',
    'succeeded',
    '--summary',
    'Consumed every delivered Skill layer; performed bounded fixture work and recorded actual command evidence.',
    '--consumed-layers',
    claim.packet.context.layers
      .filter((x) => ['action-skill', 'augmentation-skill'].includes(x.kind))
      .map((x) => x.digest)
      .join(','),
    ...(result ? ['--result-file', resultFile] : []),
  ]);
  console.log(JSON.stringify(summarize(current())));
} else if (stage === 'verify') {
  const result = run(`verify-${Date.now()}`, 'verify');
  console.log(JSON.stringify({ gate: result.result.gate, ...summarize(result.result.run) }));
} else if (stage === 'assert-final') {
  const view = current(),
    l = life(view),
    protocol = l.buildProtocol;
  assert.equal(l.phase, 'archive');
  assert.equal(protocol.packageCompletions.length, 4);
  assert.equal(protocol.verifyRepair, null);
  const snapshots = fs
    .readdirSync(evidence)
    .filter((n) => /^snapshot-.*\.json$/u.test(n))
    .map((n) => read(path.join(evidence, n)));
  const original = snapshots
    .map((x) => x.state?.changeLifecycle)
    .find((x) => x?.phase === 'verify' && x.checkEpoch === 13);
  assert(original, 'Missing original completed Build snapshot');
  assert.deepEqual(protocol.plan, original.buildProtocol.plan);
  for (const name of names) {
    const p = protocol.plan.packages.find((p) => p.packageKey === name),
      old = original.buildProtocol.packageCompletions.find((c) => c.packageId === p.packageId),
      now = protocol.packageCompletions.find((c) => c.packageId === p.packageId);
    if (name === 'a') assert.notEqual(now.completionId, old.completionId);
    else assert.deepEqual(now, old);
  }
  assert.deepEqual(l.tasks, original.tasks, 'Official Task completion facts must remain unchanged');
  const jsonl = (name) =>
    fs
      .readFileSync(path.join(evidence, name), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(JSON.parse);
  const counts = (records, key) =>
    Object.fromEntries(names.map((n) => [n, records.filter((r) => r[key] === n).length]));
  const executeCounts = counts(jsonl('execute-calls.jsonl'), 'repo'),
    machineCounts = counts(jsonl('node-calls.jsonl'), 'node');
  assert.deepEqual(executeCounts, { a: 2, b: 1, c: 1, d: 1 });
  assert.deepEqual(machineCounts, { a: 2, b: 1, c: 1, d: 1 });
  const recoveries = fs
    .readdirSync(evidence)
    .filter((n) => /^(resume|next)-.*\.json$/u.test(n))
    .map((n) => read(path.join(evidence, n)).result);
  const epochs = new Set(
    recoveries
      .filter((r) => !r.state.reconciliationRequired)
      .map((r) => r.state.changeLifecycle.checkEpoch),
  );
  for (const epoch of [14, 16, 17, 18])
    assert(epochs.has(epoch), `Missing cold recovery boundary ${epoch}`);
  assert(
    recoveries.filter((r) => r.state.reconciliationRequired).length >= 2,
    'Both unauthorized entrypoints must reject',
  );
  const receipt = {
    schemaVersion: 1,
    runId: state.runId,
    planId: protocol.plan.planId,
    originalCompletions: original.buildProtocol.packageCompletions.map((c) => c.completionId),
    finalCompletions: protocol.packageCompletions.map((c) => c.completionId),
    executeCounts,
    machineCounts,
    coldRecoveryEpochs: [14, 16, 17, 18],
    unauthorizedEntrypointsRejected: true,
    gate: 'satisfied',
    finalPhase: l.phase,
    taskFactsUnchanged: true,
    at: new Date().toISOString(),
  };
  write(file('acceptance-receipt'), receipt);
  console.log(JSON.stringify(receipt));
} else if (stage === 'snapshot') {
  const view = current();
  write(file(`snapshot-${Date.now()}`), view);
  console.log(JSON.stringify(summarize(view)));
} else if (['next', 'resume', 'status'].includes(stage))
  console.log(JSON.stringify(summarize(run(`${stage}-${Date.now()}`, stage).result)));
else throw Error(`Unknown stage ${stage}`);
