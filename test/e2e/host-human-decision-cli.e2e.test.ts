import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, expect, it } from 'vitest';

import {
  createGitRepository,
  createOpenSpecStoreEnvironment,
  removeTemporaryDirectory,
  temporaryDirectory,
} from '../helpers/fixtures.js';
import { runCli } from './cli.js';
import type { RunStatusView } from '../../domains/runtime/types.js';
import type {
  WorkExecutionPacket,
  WorkExecutionHostInvocation,
} from '../../domains/work-execution/types.js';
import type { LifecycleHumanDecisionView } from '../../services/lifecycle-human-decisions.js';

const exec = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, '../..');
const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

it('lets a non-TTY Host read and answer the actual Open request, then recover the same decision', async () => {
  const root = await temporaryDirectory('repoctopus-host-decision-');
  cleanup.push(root);
  const remote = path.join(root, 'origin.git');
  await mkdir(remote);
  await exec('git', ['init', '--bare'], { cwd: remote });
  const workspace = await createGitRepository(root, 'workspace', remote);
  const environment = await createOpenSpecStoreEnvironment(root, workspace, 'host-decision');
  const git = (args: string[]) => exec('git', args, { cwd: workspace });
  await git(['push', '-u', 'origin', 'main']);
  await git(['switch', '-c', 'change/host-decision']);
  const write = async (file: string, content: string) => {
    const target = path.join(workspace, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  };
  await write('.gitignore', '.repoctopus/\n');
  await write(
    'repoctopus.yaml',
    JSON.stringify({
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'RepoctopusWorkspace',
      workspace: { id: 'host-decision', repositoryId: 'workspace' },
      repositories: [{ id: 'workspace', path: '.' }],
      profiles: [
        {
          id: 'verify',
          nodes: [
            {
              id: 'check',
              type: 'command',
              repository: 'workspace',
              executable: process.execPath,
              args: ['-e', 'process.exit(0)'],
              covers: ['*'],
            },
          ],
        },
      ],
      specificationProvider: {
        id: 'specification-openspec',
        store: { id: 'host-decision', repositoryId: 'workspace' },
      },
    }),
  );
  await git(['add', '.']);
  await git(['commit', '-m', 'test: prepare host decision workspace']);
  await git(['push', '-u', 'origin', 'change/host-decision']);
  const cli = <T = unknown>(args: string[]) =>
    runCli<T>({ packageRoot, cwd: workspace, environment, args });
  const install = (
    await cli<{
      file: string;
      request: { apiVersion: string; requestId: string; snapshotDigest: string };
    }>(['project', 'install-entry-skills', '--entry-hosts', 'codex'])
  ).result!;
  const installationAnswer = path.join(root, 'install.json');
  await writeFile(
    installationAnswer,
    JSON.stringify({
      apiVersion: install.request.apiVersion,
      kind: 'HumanDecisionResponse',
      requestId: install.request.requestId,
      snapshotDigest: install.request.snapshotDigest,
      decision: 'approve',
    }),
  );
  await cli([
    'project',
    'review',
    '--request',
    install.file,
    '--response-file',
    installationAnswer,
  ]);
  await git(['add', '.agents']);
  await git(['commit', '-m', 'test: publish approved Workspace Skills']);
  await git(['push']);
  const started = await cli([
    'run',
    'start',
    '--change',
    'host-decision',
    '--target',
    'main',
    '--execution-mode',
    'autonomous',
  ]);
  const runId = started.runId!;
  const claimed = await cli<{
    packet: WorkExecutionPacket;
    invocation: WorkExecutionHostInvocation;
  }>([
    'run',
    'work-claim',
    '--run',
    runId,
    '--adapter',
    'manual',
    '--runner',
    'test:host-decision',
    '--skill-reference-host',
    'codex',
    '--host-capabilities',
    'repository.read,repository.write,specification.read,specification.write',
  ]);
  const { packet, invocation } = claimed.result!;
  const local = packet.context.layers.find(({ source }) => source === 'repoctopus-open-change');
  expect(local).toMatchObject({
    reference: { path: '.agents/skills/repoctopus-open-change/SKILL.md' },
  });
  expect(local).not.toHaveProperty('content');
  const contentArgv = [
    'run',
    'work-content',
    '--run',
    runId,
    '--runner',
    'test:host-decision',
    '--invocation-id',
    invocation.invocationId,
    '--host-id',
    invocation.host.id,
    '--packet-digest',
    packet.identity.packetDigest,
    '--skill-reference-host',
    'codex',
    '--layer-index',
    String(packet.context.layers.indexOf(local!)),
  ];
  const loaded = await cli<{ source: string; layer: { content: string; digest: string } }>(
    contentArgv,
  );
  expect(loaded.result).toMatchObject({ source: 'workspace', layer: { digest: local!.digest } });
  const installedAction = '.agents/skills/repoctopus-open-change/SKILL.md';
  const originalAction = await readFile(path.join(workspace, installedAction), 'utf8');
  await write(installedAction, 'local replacement');
  const fallback = await cli<typeof loaded.result>(contentArgv);
  expect(fallback.result).toMatchObject({ source: 'packet', layer: loaded.result!.layer });
  await expect(
    cli(contentArgv.map((arg) => (arg === 'test:host-decision' ? 'other-runner' : arg))),
  ).rejects.toThrow(/invocation/i);
  await write(installedAction, originalAction.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n'));
  expect((await cli<typeof loaded.result>(contentArgv)).result).toEqual(loaded.result);
  await write(installedAction, originalAction);
  await expect(cli(contentArgv.map((arg) => (arg === 'codex' ? 'opencode' : arg)))).rejects.toThrow(
    /invocation/i,
  );
  const change = 'openspec/changes/host-decision';
  await write(
    `${change}/proposal.md`,
    '# Proposal\n\n## Why\nTest real Host decisions.\n\n## What Changes\n- Add a demo behavior.\n\n## Capabilities\n### New Capabilities\n- `demo`: demo behavior.\n\n## Impact\nFixture only.\n',
  );
  await write(
    `${change}/design.md`,
    '# Design\n\n## Context\nA CLI Host needs user interaction.\n\n## Goals / Non-Goals\nProve human approval without a terminal.\n\n## Decisions\nUse explicit user responses.\n',
  );
  await write(
    `${change}/tasks.md`,
    '# Tasks\n\n- [ ] 1.1 Add demo behavior.\n  **Acceptance:** The demo is visible\n  **Requirements:** demo#demo-behavior\n',
  );
  await write(
    `${change}/specs/demo/spec.md`,
    '# Demo\n\n## ADDED Requirements\n\n### Requirement: Demo behavior\nThe system MUST expose a demo.\n\n#### Scenario: Demo\n- **WHEN** requested\n- **THEN** the demo is visible\n',
  );
  await git(['add', '.']);
  await git(['commit', '-m', 'spec: record actual Open materials']);
  await git(['push']);
  await cli([
    'run',
    'work-outcome',
    '--run',
    runId,
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
    'Prepared and validated all four Open artifacts.',
    '--consumed-layers',
    packet.context.layers
      .filter((layer) => ['action-skill', 'augmentation-skill'].includes(layer.kind))
      .map((layer) => layer.digest)
      .join(','),
  ]);
  await cli(['run', 'next', '--run', runId]);
  await expect(cli(contentArgv)).rejects.toThrow(
    /active Run Work|active external invocation|no authoritative Work claim/i,
  );
  const status = await cli<RunStatusView>(['run', 'status', '--run', runId]);
  expect(status.result!.state.status).toBe('waiting');
  expect(status.result!.state.changeLifecycle!.phase).toBe('open');
  expect(status.result!.continuation?.humanDecision?.readArgv).toEqual([
    'repoctopus',
    'run',
    'decision',
    '--run',
    runId,
    '--json',
  ]);

  const view = await cli<LifecycleHumanDecisionView>(['run', 'decision', '--run', runId]);
  expect(view.result).toMatchObject({
    status: 'pending',
    decisionKind: 'specification-open',
    authorityScope: 'planning-change',
  });
  const response = {
    ...view.result!.responseTemplate,
    decision: 'approve',
    isolation: 'branch',
    interaction: {
      channel: 'native',
      authorization: 'user-response',
      reference: 'automated-protocol-fixture-not-real-UI',
    },
  };
  const responseFile = path.join(root, 'response.json');
  for (const patch of [
    { runId: 'different-run' },
    { requestId: 'wrong-request' },
    { proposalHash: `sha256:${'0'.repeat(64)}` },
    { isolation: 'invalid' },
    { isolation: 'worktree' },
    { actorId: 'forged-human' },
    { authenticated: true },
  ]) {
    await writeFile(responseFile, JSON.stringify({ ...response, ...patch }));
    await expect(
      cli(['run', 'decide', '--run', runId, '--response-file', responseFile]),
    ).rejects.toThrow();
  }
  const beforeDrift = await readFile(path.join(workspace, change, 'design.md'), 'utf8');
  await write(
    `${change}/design.md`,
    `${beforeDrift}\nA different unreviewed engineering decision.\n`,
  );
  await writeFile(responseFile, JSON.stringify(response));
  await expect(
    cli(['run', 'decide', '--run', runId, '--response-file', responseFile]),
  ).rejects.toThrow(/drifted/);
  expect(
    (await cli<LifecycleHumanDecisionView>(['run', 'decision', '--run', runId])).result!.decision,
  ).toBeNull();
  await write(`${change}/design.md`, beforeDrift);
  await writeFile(responseFile, JSON.stringify(response));
  const accepted = await cli<LifecycleHumanDecisionView>([
    'run',
    'decide',
    '--run',
    runId,
    '--response-file',
    responseFile,
  ]);
  expect(accepted.result).toMatchObject({
    status: 'accepted',
    decision: { decision: 'approve', source: 'cli', recordedViaRunId: runId },
  });
  await cli(['run', 'next', '--run', runId]);
  const recovered = await cli<LifecycleHumanDecisionView>([
    'run',
    'decision',
    '--run',
    runId,
    '--request-id',
    view.result!.requestId!,
    '--proposal-hash',
    view.result!.proposalHash!,
  ]);
  expect(recovered.result!.status).toBe('accepted');
  const replay = await cli<LifecycleHumanDecisionView>([
    'run',
    'decide',
    '--run',
    runId,
    '--response-file',
    responseFile,
  ]);
  expect(replay.result!.decision).toEqual(accepted.result!.decision);
  await writeFile(responseFile, JSON.stringify({ ...response, isolation: 'worktree' }));
  await expect(
    cli(['run', 'decide', '--run', runId, '--response-file', responseFile]),
  ).rejects.toThrow(/conflicts/);

  const designClaim = (
    await cli<{ packet: WorkExecutionPacket; invocation: WorkExecutionHostInvocation }>([
      'run',
      'work-claim',
      '--run',
      runId,
      '--adapter',
      'manual',
      '--runner',
      'test:host-decision',
      '--skill-reference-host',
      'codex',
      '--host-capabilities',
      'repository.read,repository.write,specification.read,specification.write',
    ])
  ).result!;
  const designLayerIndex = designClaim.packet.context.layers.findIndex(
    ({ source }) => source === 'codebase-design',
  );
  expect(designClaim.packet.context.layers[designLayerIndex]).toMatchObject({
    reference: {
      resources: expect.arrayContaining([
        expect.objectContaining({
          path: 'DESIGN-IT-TWICE.md',
          installedDigest: expect.stringMatching(/^sha256:/u),
        }),
      ]),
    },
  });
  const designContent = await cli<{
    source: string;
    layer: WorkExecutionPacket['context']['layers'][number];
  }>([
    'run',
    'work-content',
    '--run',
    runId,
    '--runner',
    'test:host-decision',
    '--invocation-id',
    designClaim.invocation.invocationId,
    '--host-id',
    designClaim.invocation.host.id,
    '--packet-digest',
    designClaim.packet.identity.packetDigest,
    '--skill-reference-host',
    'codex',
    '--layer-index',
    String(designLayerIndex),
  ]);
  expect(designContent.result?.source).toBe('workspace');
  const designReference = designContent.result?.layer.resources?.find(
    ({ path }) => path === 'DESIGN-IT-TWICE.md',
  );
  expect(designReference?.encoding).toBe('utf8');
  expect(designReference?.content).toContain('design');
  await write(
    `${change}/design.md`,
    `${beforeDrift}\n## Implementation\nUse the existing public CLI for the demo.\n`,
  );
  await git(['add', '.']);
  await git(['commit', '-m', 'spec: deepen Design independently']);
  await git(['push']);
  await cli([
    'run',
    'work-outcome',
    '--run',
    runId,
    '--submission-id',
    `${designClaim.invocation.invocationId}:1`,
    '--invocation-id',
    designClaim.invocation.invocationId,
    '--host-id',
    designClaim.invocation.host.id,
    '--packet-digest',
    designClaim.packet.identity.packetDigest,
    '--status',
    'succeeded',
    '--summary',
    'Deepened the approved artifacts for engineering execution.',
    '--consumed-layers',
    designClaim.packet.context.layers
      .filter((layer) => ['action-skill', 'augmentation-skill'].includes(layer.kind))
      .map((layer) => layer.digest)
      .join(','),
  ]);
  await cli(['run', 'next', '--run', runId]);
  const design = (await cli<LifecycleHumanDecisionView>(['run', 'decision', '--run', runId]))
    .result!;
  expect(design).toMatchObject({
    status: 'pending',
    decisionKind: 'specification-design',
    requiredInputs: { approve: [] },
  });
  expect(design.requestId).not.toBe(view.result!.requestId);
  const waitingDesign = (await cli<RunStatusView>(['run', 'status', '--run', runId])).result!;
  await writeFile(responseFile, JSON.stringify(response));
  expect(
    (
      await cli<LifecycleHumanDecisionView>([
        'run',
        'decide',
        '--run',
        runId,
        '--response-file',
        responseFile,
      ])
    ).result!.status,
  ).toBe('accepted');
  expect(
    (await cli<RunStatusView>(['run', 'status', '--run', runId])).result!.state.changeLifecycle!
      .checkEpoch,
  ).toBe(waitingDesign.state.changeLifecycle!.checkEpoch);
  await writeFile(
    responseFile,
    JSON.stringify({
      ...design.responseTemplate,
      decision: 'approve',
      interaction: {
        channel: 'conversation',
        authorization: 'user-response',
        reference: 'automated-independent-design-reply',
      },
    }),
  );
  const designAccepted = await cli<LifecycleHumanDecisionView>([
    'run',
    'decide',
    '--run',
    runId,
    '--response-file',
    responseFile,
  ]);
  expect(designAccepted.result).toMatchObject({
    status: 'accepted',
    currentPhase: 'design',
    decision: { decision: 'approve', source: 'cli' },
  });
  await cli(['run', 'next', '--run', runId]);
  expect(
    (await cli<RunStatusView>(['run', 'status', '--run', runId])).result!.state.changeLifecycle!
      .phase,
  ).toBe('build');
}, 180_000);
