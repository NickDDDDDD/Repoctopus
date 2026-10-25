import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import type { RunStatusView, RuntimeResult } from '../../domains/runtime/types.js';
import type { VerifyChangeRunResult } from '../../services/workflow-runs.js';
import type { WorkClaimRequest } from '../../domains/action/types.js';
import type {
  ExternalWorkClaimResult,
  ManagedWorkExecutionResult,
} from '../../services/managed-work-executor.js';
import type { SpecificationApprovalState } from '../../domains/specification/types.js';
import { bootProjectComposition } from '../../app/boot/bootstrap.js';
import {
  createGitRepository,
  createOpenSpecStoreEnvironment,
  removeTemporaryDirectory,
  temporaryDirectory,
} from '../helpers/fixtures.js';
import { runCli } from './cli.js';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, '..', '..');
const cleanup: string[] = [];

afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

async function write(root: string, relative: string, contents: string): Promise<void> {
  const file = path.join(root, ...relative.split('/'));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents);
}

async function writeChange(
  root: string,
  changeId: string,
  mode: 'valid' | 'invalid' | 'incomplete',
): Promise<void> {
  await write(
    root,
    `openspec/changes/${changeId}/proposal.md`,
    `# Proposal\n\n## Why\n\nExercise ${changeId}.\n\n## What Changes\n\n- Add behavior.\n\n## Capabilities\n\n### New Capabilities\n\n### Modified Capabilities\n\n- \`demo\`: extend behavior.\n\n## Impact\n\n- Test only.\n`,
  );
  if (mode === 'incomplete') return;
  await write(
    root,
    `openspec/changes/${changeId}/design.md`,
    '# Design\n\n## Context\n\nTest the Design gate.\n\n## Goals / Non-Goals\n\n**Goals:**\n- Prove the gate.\n\n**Non-Goals:**\n- Production behavior.\n\n## Decisions\n\nUse the Provider result.\n',
  );
  await write(
    root,
    `openspec/changes/${changeId}/tasks.md`,
    '# Tasks\n\n- [ ] 1.1 Build it.\n  **Acceptance:** The implementation passes its required check\n  **Requirements:** demo#existing-behavior\n',
  );
  await write(
    root,
    `openspec/changes/${changeId}/specs/demo/spec.md`,
    mode === 'valid'
      ? '# Demo Delta\n\n## ADDED Requirements\n\n### Requirement: Design gate fixture\n\nThe system MUST enforce the Design gate.\n\n#### Scenario: Valid planning\n\n- **WHEN** planning is valid\n- **THEN** the gate requests a Human Decision\n'
      : '# Demo Delta\n\n## ADDED Requirements\n\nThis is not a valid requirement.\n',
  );
}

async function failure(
  workspace: string,
  environment: NodeJS.ProcessEnv,
  args: string[],
): Promise<string> {
  try {
    await runCli({ packageRoot, cwd: workspace, args, environment });
    throw new Error('Expected CLI command to fail');
  } catch (error) {
    return (error as { stderr?: string }).stderr ?? String(error);
  }
}

async function decidePending(
  workspace: string,
  changeId: string,
  runId: string,
  decision: 'approve' | 'revise' | 'reject',
): Promise<SpecificationApprovalState> {
  const app = await bootProjectComposition(packageRoot, workspace);
  try {
    const state = await app.context.specificationPlanning.status(changeId);
    if (!state || state.status !== 'awaiting_approval') throw new Error('missing pending approval');
    return app.context.commandRouter.execute('run.change.decide', {
      runId,
      response: {
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'HumanDecisionResponse',
        requestId: state.decisionRequest.requestId,
        proposalHash: state.decisionRequest.proposalHash,
        decision,
      },
      actor: { actorId: 'trusted-e2e-user', source: 'cli', authenticated: true },
    });
  } finally {
    await app.close();
  }
}

describe('Change Run Design gate CLI', () => {
  it('requires official artifacts, strict validation, and a trusted Human Decision', async () => {
    const root = await temporaryDirectory('repoctopus-design-gate-');
    cleanup.push(root);
    const remote = path.join(root, 'workspace.git');
    await mkdir(remote);
    await execFileAsync('git', ['init', '--bare', '--initial-branch=main'], { cwd: remote });
    const workspace = await createGitRepository(root, 'workspace', remote);
    await execFileAsync('git', ['push', '--set-upstream', 'origin', 'main'], { cwd: workspace });
    await execFileAsync('git', ['switch', '-c', 'spec/design-gate'], { cwd: workspace });
    const environment = await createOpenSpecStoreEnvironment(root, workspace, 'design-gate');
    await write(
      workspace,
      'repoctopus.yaml',
      `${JSON.stringify({
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'RepoctopusWorkspace',
        workspace: { id: 'design-gate', repositoryId: 'workspace' },
        repositories: [{ id: 'workspace', path: '.' }],
        profiles: [
          {
            id: 'verify',
            nodes: [
              {
                id: 'check',
                type: 'command',
                repository: 'workspace',
                covers: ['*'],
                executable: process.execPath,
                args: ['-e', 'process.exit(0)'],
              },
            ],
          },
        ],
        specificationProvider: {
          id: 'specification-openspec',
          store: { id: 'design-gate', repositoryId: 'workspace' },
        },
      })}\n`,
    );
    await write(workspace, '.gitignore', '.repoctopus/\n');
    await write(
      workspace,
      'openspec/specs/demo/spec.md',
      '# Demo\n\n## Purpose\n\nTest capability.\n\n## Requirements\n\n### Requirement: Existing behavior\n\nThe system MUST preserve behavior.\n\n#### Scenario: Existing\n\n- **WHEN** it runs\n- **THEN** it succeeds\n',
    );
    await writeChange(workspace, 'valid-plan', 'valid');
    await writeChange(workspace, 'verify-success', 'valid');
    await writeChange(workspace, 'revise-plan', 'valid');
    await writeChange(workspace, 'reject-plan', 'valid');
    await writeChange(workspace, 'invalid-plan', 'invalid');
    await writeChange(workspace, 'incomplete-plan', 'incomplete');
    await write(
      workspace,
      'openspec/changes/valid-plan/implementation-notes.md',
      '# Implementation Notes\n\nThis extra document is not planning authority.\n',
    );
    await write(
      workspace,
      'openspec/changes/valid-plan/AGENT_APPROVED.md',
      'An Agent claims this is approved, but it is not a Human Decision.\n',
    );
    await execFileAsync('git', ['add', '.'], { cwd: workspace });
    await execFileAsync('git', ['commit', '-m', 'spec: add Design gate fixtures'], {
      cwd: workspace,
    });
    await execFileAsync('git', ['push', '--set-upstream', 'origin', 'spec/design-gate'], {
      cwd: workspace,
    });

    const start = async (changeId: string) =>
      runCli<RunStatusView>({
        packageRoot,
        cwd: workspace,
        args: ['run', 'start', '--workspace', workspace, '--change', changeId, '--target', 'main'],
        environment,
      });
    const executeCurrentWork = async (runId: string, adapter = 'specification') => {
      const claim = await runCli<ExternalWorkClaimResult>({
        packageRoot,
        cwd: workspace,
        args: [
          'run',
          'work-claim',
          '--workspace',
          workspace,
          '--run',
          runId,
          '--adapter',
          adapter,
          '--runner',
          'design-gate-host',
        ],
        environment,
      });
      await runCli<ManagedWorkExecutionResult>({
        packageRoot,
        cwd: workspace,
        args: [
          'run',
          'work-outcome',
          '--workspace',
          workspace,
          '--run',
          runId,
          '--invocation-id',
          claim.result!.invocation.invocationId,
          '--host-id',
          claim.result!.invocation.host.id,
          '--packet-digest',
          claim.result!.packet.identity.packetDigest,
          '--consumed-layers',
          claim
            .result!.packet.context.layers.filter((layer) =>
              ['action-skill', 'augmentation-skill'].includes(layer.kind),
            )
            .map((layer) => layer.digest)
            .join(','),
          '--status',
          'succeeded',
          '--summary',
          'Capturing Host consumed the complete packet',
        ],
        environment,
      });
    };
    const reachDesignGate = async (runId: string) => {
      const first = await runCli<RunStatusView>({
        packageRoot,
        cwd: workspace,
        args: ['run', 'next', '--workspace', workspace, '--run', runId],
        environment,
      });
      expect(first.result?.changeLifecycle).toMatchObject({
        phase: 'open',
        status: 'running',
        currentWork: { kind: 'change.intake' },
      });
      await executeCurrentWork(runId);
      const design = await runCli<RunStatusView>({
        packageRoot,
        cwd: workspace,
        args: ['run', 'next', '--workspace', workspace, '--run', runId],
        environment,
      });
      expect(design.result?.changeLifecycle).toMatchObject({
        phase: 'design',
        status: 'running',
        currentWork: { kind: 'specification.plan' },
      });
      await executeCurrentWork(runId);
      return runCli<RunStatusView>({
        packageRoot,
        cwd: workspace,
        args: ['run', 'next', '--workspace', workspace, '--run', runId],
        environment,
      });
    };
    const validRun = await start('valid-plan');
    const waiting = await reachDesignGate(validRun.runId!);
    expect(waiting.result?.changeLifecycle).toMatchObject({
      phase: 'design',
      status: 'waiting',
      waitCondition: { kind: 'human-decision' },
    });
    expect(waiting.result?.state.specificationUsageSnapshot).toBeUndefined();

    const approval = await runCli<SpecificationApprovalState>({
      packageRoot,
      cwd: workspace,
      args: ['spec', 'approval', 'status', '--workspace', workspace, '--change', 'valid-plan'],
      environment,
    });
    expect(approval.result?.snapshot.artifacts).toHaveLength(4);
    expect(approval.result?.snapshot.schema?.artifacts).toHaveLength(4);
    expect(approval.result?.snapshot.artifacts.map((artifact) => artifact.kind)).not.toContain(
      'implementation-notes',
    );

    expect(
      await failure(workspace, environment, [
        'run',
        'record',
        '--workspace',
        workspace,
        '--run',
        validRun.runId!,
        '--action',
        'agent-claim',
        '--status',
        'succeeded',
        '--summary',
        'Agent says planning passed',
      ]),
    ).toMatch(/Generic Action outcomes cannot advance a Change Run lifecycle/u);
    const stillWaiting = await runCli<RunStatusView>({
      packageRoot,
      cwd: workspace,
      args: ['run', 'next', '--workspace', workspace, '--run', validRun.runId!],
      environment,
    });
    expect(stillWaiting.result?.changeLifecycle).toMatchObject({
      phase: 'design',
      status: 'waiting',
    });

    const wrongProposalApp = await bootProjectComposition(packageRoot, workspace);
    try {
      const pending = await wrongProposalApp.context.specificationPlanning.status('valid-plan');
      await expect(
        wrongProposalApp.context.commandRouter.execute('run.change.decide', {
          runId: validRun.runId!,
          response: {
            apiVersion: 'repoctopus/v1alpha1',
            kind: 'HumanDecisionResponse',
            requestId: pending!.decisionRequest.requestId,
            proposalHash: `sha256:${'f'.repeat(64)}`,
            decision: 'approve',
          },
          actor: { actorId: 'trusted-e2e-user', source: 'cli', authenticated: true },
        }),
      ).rejects.toThrow(/does not match the current Change Run proposal/u);
    } finally {
      await wrongProposalApp.close();
    }
    await decidePending(workspace, 'valid-plan', validRun.runId!, 'approve');
    const approved = await runCli<RunStatusView>({
      packageRoot,
      cwd: workspace,
      args: ['run', 'next', '--workspace', workspace, '--run', validRun.runId!],
      environment,
    });
    expect(approved.result?.changeLifecycle).toMatchObject({ phase: 'build', status: 'running' });
    expect(approved.result?.changeLifecycle).toMatchObject({
      taskProgress: { total: 1, completed: 0, currentTaskId: '1.1' },
      currentWork: {
        phase: 'build',
        kind: 'task.implement',
        taskId: '1.1',
        actionSkill: {
          name: 'repoctopus-build-task',
          provider: 'repoctopus-lifecycle',
        },
        augmentationSkills: [
          { name: 'tdd', provider: 'matt-builtins' },
          { name: 'codebase-design', provider: 'matt-builtins' },
        ],
        methodProfile: { id: 'repoctopus.build', version: '1.0.0' },
        capabilities: ['process.execute', 'repository.read', 'repository.write'],
        sideEffectClass: 'repository-write',
        outputContract: { artifactKinds: [], trackerPublish: false },
        validatorProfile: { id: 'build.task-valid', version: '1.0.0' },
        checkpoint: 'build.before-task',
      },
      nextActions: [{ kind: 'work', label: 'Implement Task 1.1' }],
    });
    expect(approved.result?.changeLifecycle?.currentWork?.taskRevision).toMatch(
      /^sha256:[a-f0-9]{64}$/u,
    );
    const persistedBuild = await runCli<RunStatusView>({
      packageRoot,
      cwd: workspace,
      args: ['run', 'status', '--workspace', workspace, '--run', validRun.runId!],
      environment,
    });
    expect(persistedBuild.result?.changeLifecycle?.currentWork).toEqual(
      approved.result?.changeLifecycle?.currentWork,
    );
    expect(persistedBuild.result?.changeLifecycle?.nextActions).toEqual(
      approved.result?.changeLifecycle?.nextActions,
    );
    expect(approved.result?.state.specificationUsageSnapshot).toMatchObject({
      changeId: 'valid-plan',
      provider: { id: 'openspec' },
    });
    const approvedWorkId = approved.result?.changeLifecycle?.currentWork?.workId;
    const outcomeApp = await bootProjectComposition(packageRoot, workspace);
    try {
      expect(outcomeApp.context.workDispatcher.list()).toEqual([
        'git',
        'manual',
        'process',
        'specification',
      ]);
    } finally {
      await outcomeApp.close();
    }
    const claim = await runCli<ExternalWorkClaimResult>({
      packageRoot,
      cwd: workspace,
      args: [
        'run',
        'work-claim',
        '--workspace',
        workspace,
        '--run',
        validRun.runId!,
        '--adapter',
        'process',
        '--runner',
        'runner-a',
      ],
      environment,
    });
    expect(claim.result?.packet.context.layers.map((entry) => entry.source)).toEqual([
      'repoctopus-runtime',
      'repoctopus-build-task',
      'openspec:build',
      'tdd',
      'codebase-design',
      'repoctopus.build@1.0.0',
      approvedWorkId,
    ]);
    expect(
      await failure(workspace, environment, [
        'run',
        'work-outcome',
        '--workspace',
        workspace,
        '--run',
        validRun.runId!,
        '--invocation-id',
        claim.result!.invocation.invocationId,
        '--host-id',
        'external:cli:forged-runner',
        '--packet-digest',
        claim.result!.packet.identity.packetDigest,
        '--status',
        'succeeded',
        '--summary',
        'forged Host',
      ]),
    ).toMatch(/does not match the authoritative invocation/u);
    expect(
      await failure(workspace, environment, [
        'run',
        'work-outcome',
        '--workspace',
        workspace,
        '--run',
        validRun.runId!,
        '--invocation-id',
        claim.result!.invocation.invocationId,
        '--host-id',
        claim.result!.invocation.host.id,
        '--packet-digest',
        `sha256:${'f'.repeat(64)}`,
        '--status',
        'succeeded',
        '--summary',
        'forged packet',
      ]),
    ).toMatch(/does not match the authoritative invocation/u);
    const accepted = await runCli<ManagedWorkExecutionResult>({
      packageRoot,
      cwd: workspace,
      args: [
        'run',
        'work-outcome',
        '--workspace',
        workspace,
        '--run',
        validRun.runId!,
        '--invocation-id',
        claim.result!.invocation.invocationId,
        '--host-id',
        claim.result!.invocation.host.id,
        '--packet-digest',
        claim.result!.packet.identity.packetDigest,
        '--status',
        'failed',
        '--summary',
        'Process Adapter failed',
      ],
      environment,
    });
    expect(accepted.result).toMatchObject({
      hostOutcome: { status: 'failed' },
      acceptance: {
        validation: 'pending',
        lifecycleAdvanced: false,
        receipt: {
          adapter: 'process',
          outcome: 'failed',
          executor: { runnerId: 'runner-a', source: 'cli', authenticated: true },
        },
      },
    });
    const failedReceiptId = accepted.result!.acceptance!.receipt.receiptId;
    const outcomeDidNotAdvance = await runCli<RunStatusView>({
      packageRoot,
      cwd: workspace,
      args: ['run', 'status', '--workspace', workspace, '--run', validRun.runId!],
      environment,
    });
    expect(outcomeDidNotAdvance.result?.changeLifecycle).toMatchObject({
      phase: 'build',
      status: 'running',
      taskProgress: { total: 1, completed: 0, currentTaskId: '1.1' },
      currentWork: { workId: approvedWorkId },
    });
    const failedValidation = await runCli<RuntimeResult<{ validation: { status: string } }>>({
      packageRoot,
      cwd: workspace,
      args: [
        'run',
        'work-validate',
        '--workspace',
        workspace,
        '--run',
        validRun.runId!,
        '--receipt',
        failedReceiptId,
      ],
      environment,
    });
    expect(failedValidation.result?.value.validation.status).toBe('failed');
    const openSpecEnvironmentKeys = [
      'XDG_DATA_HOME',
      'XDG_CONFIG_HOME',
      'OPENSPEC_NO_UPDATE_CHECK',
      'OPENSPEC_TELEMETRY',
    ] as const;
    const previousOpenSpecEnvironment = Object.fromEntries(
      openSpecEnvironmentKeys.map((key) => [key, process.env[key]]),
    );
    for (const key of openSpecEnvironmentKeys) process.env[key] = environment[key];
    const validationApp = await bootProjectComposition(packageRoot, workspace);
    try {
      const failed = await validationApp.context.workflowRuns.validateBuildTask({
        runId: validRun.runId!,
        receiptId: failedReceiptId,
      });
      expect(failed.value.validation.status).toBe('failed');
      expect(failed.value.run.changeLifecycle).toMatchObject({
        phase: 'build',
        taskProgress: { completed: 0, currentTaskId: '1.1' },
      });
      const repairIntent = await validationApp.context.commandRouter.execute<
        WorkClaimRequest,
        ExternalWorkClaimResult
      >('run.work.claim', {
        runId: validRun.runId!,
        adapter: 'process',
        attempt: 2,
        executor: {
          actorId: 'bob',
          runnerId: 'runner-b',
          source: 'runner',
          authenticated: true,
        },
      });
      expect(repairIntent.intent.executor).toMatchObject({ actorId: 'bob', runnerId: 'runner-b' });
      expect(repairIntent.packet.context.layers.map((entry) => entry.source)).toEqual([
        'repoctopus-runtime',
        'repoctopus-build-task',
        'openspec:build',
        'tdd',
        'codebase-design',
        'diagnosing-bugs',
        'repoctopus.build@1.0.0',
        approvedWorkId,
      ]);
      const repaired = await validationApp.context.managedWorkExecutor.acceptExternalOutcome({
        schemaVersion: 1,
        runId: validRun.runId!,
        invocationId: repairIntent.invocation.invocationId,
        hostId: repairIntent.invocation.host.id,
        packetDigest: repairIntent.packet.identity.packetDigest,
        status: 'succeeded',
        summary: 'Repair Process Adapter succeeded',
        consumedLayerDigests: repairIntent.packet.context.layers
          .filter((layer) => ['action-skill', 'augmentation-skill'].includes(layer.kind))
          .map((layer) => layer.digest),
      });
      expect(repaired).toMatchObject({
        acceptance: {
          lifecycleAdvanced: false,
          receipt: { executor: { actorId: 'bob', runnerId: 'runner-b' } },
        },
      });
      const beforeValidation = await validationApp.context.workflowRuns.status(validRun.runId!);
      expect(beforeValidation.changeLifecycle).toMatchObject({
        phase: 'build',
        taskProgress: { completed: 0, currentTaskId: '1.1' },
      });
      const validated = await validationApp.context.workflowRuns.validateBuildTask({
        runId: validRun.runId!,
        receiptId: repaired.acceptance!.receipt.receiptId,
      });
      expect(validated.value).toMatchObject({
        validation: { status: 'validated', taskId: '1.1' },
        run: {
          changeLifecycle: {
            phase: 'build',
            taskProgress: { total: 1, completed: 1, currentTaskId: null },
            currentWork: null,
          },
        },
      });
      const replay = await validationApp.context.workflowRuns.validateBuildTask({
        runId: validRun.runId!,
        receiptId: repaired.acceptance!.receipt.receiptId,
      });
      expect(replay.value.validation.status).toBe('already-completed');
    } finally {
      await validationApp.close();
      for (const key of openSpecEnvironmentKeys) {
        const previous = previousOpenSpecEnvironment[key];
        if (previous === undefined) delete process.env[key];
        else process.env[key] = previous;
      }
    }
    const tasksFile = path.join(workspace, 'openspec', 'changes', 'valid-plan', 'tasks.md');
    expect(await readFile(tasksFile, 'utf8')).toContain('- [x] 1.1 Build it.');
    await execFileAsync('git', ['add', 'openspec/changes/valid-plan/tasks.md'], {
      cwd: workspace,
    });
    await execFileAsync('git', ['commit', '-m', 'test: complete task checkbox'], {
      cwd: workspace,
    });
    await execFileAsync('git', ['push'], { cwd: workspace });
    const verificationReady = await runCli<RunStatusView>({
      packageRoot,
      cwd: workspace,
      args: ['run', 'next', '--workspace', workspace, '--run', validRun.runId!],
      environment,
    });
    expect(verificationReady.result?.changeLifecycle).toMatchObject({
      phase: 'verify',
      status: 'running',
      taskProgress: { total: 1, completed: 1, currentTaskId: null },
      currentWork: {
        kind: 'evidence.verify',
        actionSkill: {
          name: 'repoctopus-verify-change',
          provider: 'repoctopus-lifecycle',
        },
      },
      verificationInput: {
        taskRevisions: [{ taskId: '1.1' }],
        repositories: [
          {
            repositoryId: 'workspace',
          },
        ],
        evidenceProfile: { id: 'verify' },
        skills: [
          { name: 'code-review' },
          { name: 'codebase-design' },
          { name: 'tdd' },
          { name: 'repoctopus-build-task' },
          { name: 'repoctopus-design-change' },
          { name: 'repoctopus-open-change' },
          { name: 'repoctopus-verify-change' },
        ],
      },
    });
    const frozenVerification = verificationReady.result?.changeLifecycle?.verificationInput;
    expect(frozenVerification?.repositories[0]?.commit).toMatch(/^[a-f0-9]{40,64}$/u);
    expect(frozenVerification?.repositories[0]?.tree).toMatch(/^[a-f0-9]{40,64}$/u);
    expect(frozenVerification?.projectConfigDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(frozenVerification?.compositionDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(verificationReady.result?.changeLifecycle?.currentWork?.inputDigest).toBe(
      verificationReady.result?.changeLifecycle?.verificationInput?.digest,
    );
    const verifyWorkId = verificationReady.result?.changeLifecycle?.currentWork?.workId;

    const designFile = path.join(workspace, 'openspec', 'changes', 'valid-plan', 'design.md');
    await writeFile(
      designFile,
      `${await readFile(designFile, 'utf8')}\n## New semantic decision\n\nUse a changed public seam.\n`,
    );
    await execFileAsync('git', ['add', 'openspec/changes/valid-plan/design.md'], {
      cwd: workspace,
    });
    await execFileAsync('git', ['commit', '-m', 'spec: change Design semantics'], {
      cwd: workspace,
    });
    await execFileAsync('git', ['push'], { cwd: workspace });
    const invalidated = await runCli<RunStatusView>({
      packageRoot,
      cwd: workspace,
      args: ['run', 'next', '--workspace', workspace, '--run', validRun.runId!],
      environment,
    });
    expect(invalidated.result?.changeLifecycle).toMatchObject({
      phase: 'design',
      status: 'running',
      currentWork: null,
      taskProgress: { total: 0, completed: 0, currentTaskId: null },
    });
    const invalidationApp = await bootProjectComposition(packageRoot, workspace);
    try {
      const trajectory = await invalidationApp.context.runStore.loadTrajectory(validRun.runId!);
      expect(trajectory.at(-1)?.data).toMatchObject({
        observationKind: 'planning-semantic-drift',
        changeLifecycleTransition: {
          transitionId: 'verify.semantic-plan-drift',
          invalidation: {
            kind: 'planning-semantic-drift',
            supersededWorkId: verifyWorkId,
          },
        },
      });
      expect(
        (await invalidationApp.context.specificationPlanning.status('valid-plan'))?.status,
      ).toBe('awaiting_approval');
    } finally {
      await invalidationApp.close();
    }

    const verifySuccessRun = await start('verify-success');
    await reachDesignGate(verifySuccessRun.runId!);
    await decidePending(workspace, 'verify-success', verifySuccessRun.runId!, 'approve');
    await runCli<RunStatusView>({
      packageRoot,
      cwd: workspace,
      args: ['run', 'next', '--workspace', workspace, '--run', verifySuccessRun.runId!],
      environment,
    });
    for (const key of openSpecEnvironmentKeys) process.env[key] = environment[key];
    const verifyApp = await bootProjectComposition(packageRoot, workspace);
    try {
      const claim = await verifyApp.context.managedWorkExecutor.claimExternal({
        runId: verifySuccessRun.runId!,
        adapter: 'process',
        executor: {
          actorId: 'verify-user',
          runnerId: 'verify-runner',
          source: 'runner',
          authenticated: true,
        },
      });
      const outcome = await verifyApp.context.managedWorkExecutor.acceptExternalOutcome({
        schemaVersion: 1,
        runId: verifySuccessRun.runId!,
        invocationId: claim.invocation.invocationId,
        hostId: claim.invocation.host.id,
        packetDigest: claim.packet.identity.packetDigest,
        status: 'succeeded',
        summary: 'Build completed',
        consumedLayerDigests: claim.packet.context.layers
          .filter((layer) => ['action-skill', 'augmentation-skill'].includes(layer.kind))
          .map((layer) => layer.digest),
      });
      await verifyApp.context.workflowRuns.validateBuildTask({
        runId: verifySuccessRun.runId!,
        receiptId: outcome.acceptance!.receipt.receiptId,
      });
    } finally {
      await verifyApp.close();
      for (const key of openSpecEnvironmentKeys) {
        const previous = previousOpenSpecEnvironment[key];
        if (previous === undefined) delete process.env[key];
        else process.env[key] = previous;
      }
    }
    await execFileAsync('git', ['add', 'openspec/changes/verify-success/tasks.md'], {
      cwd: workspace,
    });
    await execFileAsync('git', ['commit', '-m', 'test: complete verification success task'], {
      cwd: workspace,
    });
    await execFileAsync('git', ['push'], { cwd: workspace });
    await runCli<RunStatusView>({
      packageRoot,
      cwd: workspace,
      args: ['run', 'next', '--workspace', workspace, '--run', verifySuccessRun.runId!],
      environment,
    });
    await executeCurrentWork(verifySuccessRun.runId!, 'process');
    const verified = await runCli<RuntimeResult<VerifyChangeRunResult>['value']>({
      packageRoot,
      cwd: workspace,
      args: ['run', 'verify', '--workspace', workspace, '--run', verifySuccessRun.runId!],
      environment,
    });
    expect(verified.result).toMatchObject({
      gate: 'satisfied',
      run: {
        changeLifecycle: {
          phase: 'archive',
          status: 'running',
          currentWork: null,
          evidence: { gateStatus: 'satisfied' },
        },
      },
    });
    const gateApp = await bootProjectComposition(packageRoot, workspace);
    try {
      expect(verified.result!.run.state.acceptedEvidenceBundleIds).toEqual([
        verified.result!.bundleId,
      ]);
      const evidence = await gateApp.context.evidenceCoordinator.status(verified.result!.attemptId);
      expect(evidence).toMatchObject({
        context: {
          status: 'completed',
          workflowBinding: { workflowRunId: verifySuccessRun.runId },
        },
        bundle: {
          bundleId: verified.result!.bundleId,
          acceptanceTrace: { total: 1, passed: 1, failed: 0, missing: 0 },
        },
        gate: {
          status: 'satisfied',
          verificationInputDigest: verified.result!.run.changeLifecycle?.verificationInput?.digest,
        },
      });
    } finally {
      await gateApp.close();
    }

    for (const [changeId, decision, expectedStatus] of [
      ['revise-plan', 'revise', 'changes_requested'],
      ['reject-plan', 'reject', 'rejected'],
    ] as const) {
      const run = await start(changeId);
      const unapproved = await reachDesignGate(run.runId!);
      expect(unapproved.result?.changeLifecycle?.currentWork).toBeNull();
      const result = await decidePending(workspace, changeId, run.runId!, decision);
      expect(result.status).toBe(expectedStatus);
      const blocked = await runCli<RunStatusView>({
        packageRoot,
        cwd: workspace,
        args: ['run', 'next', '--workspace', workspace, '--run', run.runId!],
        environment,
      });
      expect(blocked.result?.changeLifecycle).toMatchObject({
        phase: 'design',
        status: 'blocked',
      });
    }

    for (const changeId of ['invalid-plan']) {
      const run = await start(changeId);
      const blocked = await reachDesignGate(run.runId!);
      expect(blocked.result?.changeLifecycle).toMatchObject({
        phase: 'design',
        status: 'blocked',
        blocker: { code: 'design.planning-invalid' },
      });
    }
  }, 180_000);
});
