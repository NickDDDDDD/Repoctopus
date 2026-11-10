import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Acceptance operator. Uses only installed public CLIs and ordinary Git/files.
// A Host must obtain the actual user reply before writing response.json.
const [rootArg, cliArg, stage = 'status', responseArg] = process.argv.slice(2);
assert(
  rootArg && cliArg,
  'Usage: node acceptance.mjs <fresh-lab-root> <installed-cli> <stage> [response-file]',
);
const root = path.resolve(rootArg),
  cliFile = path.resolve(cliArg);
const workspace = path.join(root, 'workspace'),
  evidence = path.join(root, 'evidence');
const changeId = 'verify-host-decisions',
  branch = `change/${changeId}`;
fs.mkdirSync(evidence, { recursive: true });
const env = {
  ...process.env,
  XDG_DATA_HOME: path.join(root, 'xdg-data'),
  XDG_CONFIG_HOME: path.join(root, 'xdg-config'),
  OPENSPEC_NO_UPDATE_CHECK: '1',
  OPENSPEC_TELEMETRY: '0',
  REPOCTOPUS_DESKTOP_EXECUTABLE: process.execPath,
};
const stateFile = path.join(evidence, 'operator.json');
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
}
function command(program, args, cwd = workspace) {
  const result = spawnSync(program, args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  fs.appendFileSync(
    path.join(evidence, 'commands.jsonl'),
    `${JSON.stringify({ at: new Date().toISOString(), program, args, cwd, exitCode: result.status, stdout: result.stdout, stderr: result.stderr, error: result.error?.message })}\n`,
  );
  assert.equal(result.status, 0, `${program}: ${result.stderr ?? result.error}`);
  return result.stdout;
}
const git = (repo, args) => command('git', args, path.join(root, repo));
function commit(repo, message) {
  git(repo, ['add', '.']);
  if (git(repo, ['status', '--porcelain']).trim()) {
    git(repo, ['commit', '-m', message]);
    git(repo, ['push']);
  }
}
function cli(label, args) {
  const value = JSON.parse(
    command(process.execPath, [cliFile, ...args, '--workspace', workspace, '--json']),
  );
  assert(value.ok);
  write(path.join(evidence, `${label}.json`), value);
  return value;
}
const run = (action) => cli(`${action}-${Date.now()}`, ['run', action, '--run', state.runId]);
function print(value) {
  console.log(JSON.stringify(value, null, 2));
}

if (stage === 'init') {
  assert(
    !state.runId && !fs.existsSync(path.join(workspace, '.git')),
    'Fresh lab required; never replace an existing Run',
  );
  for (const name of ['workspace', 'frontend', 'backend']) {
    const repo = path.join(root, name),
      remote = path.join(root, `${name}.git`);
    fs.mkdirSync(repo, { recursive: true });
    fs.mkdirSync(remote);
    command('git', ['init', '--bare', '--initial-branch=main'], remote);
    command('git', ['init', '--initial-branch=main'], repo);
    git(name, ['config', 'user.name', 'Host Decision Acceptance']);
    git(name, ['config', 'user.email', 'host-decision@example.invalid']);
    git(name, ['config', 'core.autocrlf', 'false']);
    write(path.join(repo, 'README.md'), `# ${name}\n`);
    git(name, ['add', '.']);
    git(name, ['commit', '-m', 'test: establish lab baseline']);
    git(name, ['remote', 'add', 'origin', `../${name}.git`]);
    git(name, ['push', '-u', 'origin', 'main']);
    git(name, ['switch', '-c', branch]);
    git(name, ['push', '-u', 'origin', branch]);
  }
  const openspec = path.resolve(
    path.dirname(cliFile),
    '../../@fission-ai/openspec/bin/openspec.js',
  );
  command(process.execPath, [
    openspec,
    'init',
    workspace,
    '--tools',
    'none',
    '--no-animation',
    '--no-copilot-cloud',
  ]);
  command(process.execPath, [
    openspec,
    'store',
    'setup',
    'host-decision-lab',
    '--path',
    workspace,
    '--no-init-git',
    '--json',
  ]);
  write(path.join(workspace, '.gitignore'), '.repoctopus/\n');
  for (const name of ['frontend', 'backend']) {
    write(path.join(root, name, 'openspec/config.yaml'), 'store: host-decision-lab\n');
    commit(name, 'test: use the isolated shared Store');
  }
  write(path.join(workspace, 'repoctopus.yaml'), {
    apiVersion: 'repoctopus/v1alpha1',
    kind: 'RepoctopusWorkspace',
    workspace: { id: 'host-decision-lab', repositoryId: 'workspace' },
    repositories: ['workspace', 'frontend', 'backend'].map((id) => ({
      id,
      path: id === 'workspace' ? '.' : `../${id}`,
    })),
    profiles: [
      {
        id: 'verify',
        nodes: ['frontend', 'backend'].map((id) => ({
          id: `check-${id}`,
          type: 'command',
          repository: id,
          required: true,
          covers: ['*'],
          executable: process.execPath,
          args: [
            '-e',
            "require('node:assert/strict')(require('node:fs').readFileSync('README.md','utf8').startsWith('#'))",
          ],
        })),
      },
    ],
    specificationProvider: {
      id: 'specification-openspec',
      store: { id: 'host-decision-lab', repositoryId: 'workspace' },
    },
  });
  commit('workspace', 'test: configure the three-repository acceptance Workspace');
  print({
    workspace,
    repositories: ['workspace', 'frontend', 'backend'],
    registry: env.XDG_DATA_HOME,
  });
} else if (stage === 'start') {
  assert(!state.runId, 'Do not replace a started Run');
  const started = cli('started', [
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
  state.runId = started.runId;
  write(stateFile, state);
  print({ runId: state.runId });
} else if (stage === 'work') {
  const status = run('status').result;
  const kind = status.state.changeLifecycle.currentWork?.kind;
  assert(
    ['change.intake', 'specification.plan'].includes(kind),
    'Only Open/Design fixture work is permitted',
  );
  const { packet, invocation } = cli(`claim-${kind}`, [
    'run',
    'work-claim',
    '--run',
    state.runId,
    '--adapter',
    'manual',
    '--runner',
    'codex:host-decision-acceptance',
    '--host-capabilities',
    'repository.read,repository.write,specification.read,specification.write',
  ]).result;
  assert(packet.context.layers.every((layer) => typeof layer.content === 'string'));
  const dir = path.join(workspace, 'openspec/changes', changeId);
  if (kind === 'change.intake') {
    write(
      path.join(dir, 'proposal.md'),
      '# Proposal\n\n## Why\nVerify real Host decisions in an isolated multi-repository Workspace.\n\n## What Changes\n- Validate separate Open and Design decisions without a terminal.\n\n## Capabilities\n### New Capabilities\n- `host-acceptance`: isolated approval acceptance.\n\n## Impact\nOnly this lab; no production changes or remote publication.\n',
    );
    write(
      path.join(dir, 'design.md'),
      '# Design\n\n## Context\nThree local Git repositories share a dedicated OpenSpec Store registry.\n\n## Goals / Non-Goals\nExercise real user replies and public CLI recovery; no release or merge.\n\n## Decisions\nUse branch isolation and separate Open/Design request identities. Stop in Build after both decisions are accepted.\n',
    );
    write(
      path.join(dir, 'tasks.md'),
      '# Tasks\n\n- [ ] 1.1 Validate frontend README.\n  **Acceptance:** The frontend README has its heading\n  **Requirements:** host-acceptance#independent-human-decisions\n- [ ] 1.2 Validate backend README.\n  **Acceptance:** The backend README has its heading\n  **Requirements:** host-acceptance#independent-human-decisions\n',
    );
    write(
      path.join(dir, 'specs/host-acceptance/spec.md'),
      '# Host Acceptance\n\n## ADDED Requirements\n\n### Requirement: Independent human decisions\nThe system MUST retain independent Open and Design approvals.\n\n#### Scenario: Real Host reply\n- **WHEN** the Host submits the actual selected answer\n- **THEN** the Runtime accepts only the exact request and proposal\n',
    );
  } else {
    fs.appendFileSync(
      path.join(dir, 'design.md'),
      '\n## Verification\nUse the installed package from separate processes, retain the original Open decision, and verify that replay cannot approve Design. Both business repository checkouts remain bound to their approved branches.\n',
    );
  }
  commit('workspace', `spec: prepare ${kind} acceptance materials`);
  cli(`outcome-${kind}`, [
    'run',
    'work-outcome',
    '--run',
    state.runId,
    '--submission-id',
    `${invocation.invocationId}:1`,
    '--invocation-id',
    invocation.invocationId,
    '--host-id',
    invocation.host.id,
    '--packet-digest',
    packet.identity.packetDigest,
    '--status',
    'succeeded',
    '--summary',
    'Read every delivered Skill layer, prepared the bounded lab artifacts, and committed/pushed them.',
    '--consumed-layers',
    packet.context.layers
      .filter((layer) => ['action-skill', 'augmentation-skill'].includes(layer.kind))
      .map((layer) => layer.digest)
      .join(','),
  ]);
  run('next');
  print(cli('decision-current', ['run', 'decision', '--run', state.runId]).result);
} else if (stage === 'read') {
  print(cli('decision-current', ['run', 'decision', '--run', state.runId]).result);
} else if (stage === 'submit') {
  assert(responseArg, 'A response written after the actual user reply is required');
  print(
    cli(`submitted-${Date.now()}`, [
      'run',
      'decide',
      '--run',
      state.runId,
      '--response-file',
      path.resolve(responseArg),
    ]).result,
  );
} else if (stage === 'query') {
  assert(responseArg);
  const response = JSON.parse(fs.readFileSync(path.resolve(responseArg), 'utf8'));
  print(
    cli(`queried-${Date.now()}`, [
      'run',
      'decision',
      '--run',
      state.runId,
      '--request-id',
      response.requestId,
      '--proposal-hash',
      response.proposalHash,
    ]).result,
  );
} else if (stage === 'next' || stage === 'status') {
  const result = run(stage).result;
  print({
    phase: result.state.changeLifecycle.phase,
    status: result.state.status,
    epoch: result.state.changeLifecycle.checkEpoch,
    workId: result.state.changeLifecycle.currentWork?.workId,
    continuation: result.continuation,
  });
} else throw new Error(`Unknown stage: ${stage}`);
