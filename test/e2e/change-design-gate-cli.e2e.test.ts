import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import type { RunStatusView } from '../../domains/runtime/types.js';
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

async function trustPendingDecision(workspace: string, changeId: string): Promise<void> {
  const app = await bootProjectComposition(packageRoot, workspace);
  try {
    const state = await app.context.specificationPlanning.status(changeId);
    if (!state || state.status !== 'awaiting_approval') throw new Error('missing pending approval');
    await app.context.specificationPlanning.decide({
      changeId,
      response: {
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'HumanDecisionResponse',
        requestId: state.decisionRequest.requestId,
        snapshotDigest: state.decisionRequest.snapshotDigest,
        decision: 'approve',
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

    await trustPendingDecision(workspace, 'valid-plan');
    const approved = await runCli<RunStatusView>({
      packageRoot,
      cwd: workspace,
      args: ['run', 'next', '--workspace', workspace, '--run', validRun.runId!],
      environment,
    });
    expect(approved.result?.changeLifecycle).toMatchObject({ phase: 'build', status: 'running' });
    expect(approved.result?.state.specificationUsageSnapshot).toMatchObject({
      changeId: 'valid-plan',
      provider: { id: 'openspec' },
    });

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
