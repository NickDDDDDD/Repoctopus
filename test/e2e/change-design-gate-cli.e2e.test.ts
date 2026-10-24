import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import type { RunStatusView } from '../../domains/runtime/types.js';
import type {
  ActionIntent,
  WorkClaimRequest,
  WorkOutcomeAcceptance,
} from '../../domains/action/types.js';
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
  await write(root, `openspec/changes/${changeId}/tasks.md`, '# Tasks\n\n- [ ] 1.1 Build it.\n');
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
    const validRun = await start('valid-plan');
    const waiting = await runCli<RunStatusView>({
      packageRoot,
      cwd: workspace,
      args: ['run', 'next', '--workspace', workspace, '--run', validRun.runId!],
      environment,
    });
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
        actionSkill: { name: 'tdd', provider: 'matt-builtins' },
        augmentationSkills: [{ name: 'codebase-design', provider: 'matt-builtins' }],
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
    let failedReceiptId: string;
    const outcomeApp = await bootProjectComposition(packageRoot, workspace);
    try {
      expect(outcomeApp.context.workDispatcher.list()).toEqual([
        'git',
        'manual',
        'process',
        'specification',
      ]);
      const intent = await outcomeApp.context.commandRouter.execute<
        WorkClaimRequest,
        ActionIntent
      >('run.work.claim', {
        runId: validRun.runId!,
        adapter: 'process',
        executor: {
          actorId: 'alice',
          runnerId: 'runner-a',
          source: 'cli',
          authenticated: true,
        },
      });
      const accepted = await outcomeApp.context.commandRouter.execute<
        ReturnType<typeof outcomeApp.context.workDispatcher.outcome>,
        WorkOutcomeAcceptance
      >(
        'run.work.outcome',
        outcomeApp.context.workDispatcher.outcome(intent, 'failed', 'Process Adapter failed'),
      );
      expect(accepted).toMatchObject({
        validation: 'pending',
        lifecycleAdvanced: false,
        receipt: {
          adapter: 'process',
          outcome: 'failed',
          executor: { actorId: 'alice', runnerId: 'runner-a' },
        },
      });
      failedReceiptId = accepted.receipt.receiptId;
    } finally {
      await outcomeApp.close();
    }
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
        ActionIntent
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
      expect(repairIntent.executor).toMatchObject({ actorId: 'bob', runnerId: 'runner-b' });
      const repaired = await validationApp.context.workDispatcher.acceptOutcome(
        validationApp.context.workDispatcher.outcome(
          repairIntent,
          'succeeded',
          'Repair Process Adapter succeeded',
        ),
      );
      expect(repaired).toMatchObject({
        lifecycleAdvanced: false,
        receipt: { executor: { actorId: 'bob', runnerId: 'runner-b' } },
      });
      const beforeValidation = await validationApp.context.workflowRuns.status(validRun.runId!);
      expect(beforeValidation.changeLifecycle).toMatchObject({
        phase: 'build',
        taskProgress: { completed: 0, currentTaskId: '1.1' },
      });
      const validated = await validationApp.context.workflowRuns.validateBuildTask({
        runId: validRun.runId!,
        receiptId: repaired.receipt.receiptId,
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
        receiptId: repaired.receipt.receiptId,
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
    const checkboxOnly = await runCli<RunStatusView>({
      packageRoot,
      cwd: workspace,
      args: ['run', 'next', '--workspace', workspace, '--run', validRun.runId!],
      environment,
    });
    expect(checkboxOnly.result?.changeLifecycle).toMatchObject({
      phase: 'build',
      status: 'running',
      taskProgress: { total: 1, completed: 1, currentTaskId: null },
      currentWork: null,
    });

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
          transitionId: 'build.semantic-plan-drift',
          invalidation: {
            kind: 'planning-semantic-drift',
            supersededWorkId: null,
          },
        },
      });
      expect(
        (await invalidationApp.context.specificationPlanning.status('valid-plan'))?.status,
      ).toBe('awaiting_approval');
    } finally {
      await invalidationApp.close();
    }

    for (const [changeId, decision, expectedStatus] of [
      ['revise-plan', 'revise', 'changes_requested'],
      ['reject-plan', 'reject', 'rejected'],
    ] as const) {
      const run = await start(changeId);
      const unapproved = await runCli<RunStatusView>({
        packageRoot,
        cwd: workspace,
        args: ['run', 'next', '--workspace', workspace, '--run', run.runId!],
        environment,
      });
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

    for (const changeId of ['invalid-plan', 'incomplete-plan']) {
      const run = await start(changeId);
      const blocked = await runCli<RunStatusView>({
        packageRoot,
        cwd: workspace,
        args: ['run', 'next', '--workspace', workspace, '--run', run.runId!],
        environment,
      });
      expect(blocked.result?.changeLifecycle).toMatchObject({
        phase: 'design',
        status: 'blocked',
        blocker: { code: 'design.planning-invalid' },
      });
    }
  }, 60_000);
});
