import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

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

async function writeChange(root: string, changeId: string, valid: boolean): Promise<void> {
  await write(
    root,
    `openspec/changes/${changeId}/proposal.md`,
    `# Change: ${changeId}\n\n## Why\nThe fixture needs another behavior.\n\n## What Changes\n- Add another behavior.\n\n## Capabilities\n- \`demo\`: extend the demo capability.\n\n## Impact\n- Test fixture only.\n`,
  );
  await write(
    root,
    `openspec/changes/${changeId}/design.md`,
    '# Design\n\n## Context\nThe fixture extends one capability.\n\n## Goals / Non-Goals\n\n**Goals:**\n- Add one requirement.\n\n**Non-Goals:**\n- Change runtime behavior.\n\n## Decisions\nUse the official OpenSpec lifecycle.\n',
  );
  await write(
    root,
    `openspec/changes/${changeId}/tasks.md`,
    '# Tasks\n\n- [x] 1.1 Complete fixture.\n  **Acceptance:** The fixture behavior is observable\n',
  );
  await write(
    root,
    `openspec/changes/${changeId}/specs/demo/spec.md`,
    valid
      ? '# Spec Delta\n\n## ADDED Requirements\n\n### Requirement: Added behavior\nThe system MUST add behavior.\n\n#### Scenario: Added action\n- **WHEN** the new action runs\n- **THEN** it succeeds\n'
      : '# Spec Delta\n\n## ADDED Requirements\n\nMissing requirement structure.\n',
  );
}

async function runFailure(
  workspace: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
): Promise<{
  code?: number;
  diagnostics?: Array<{ message?: string }>;
}> {
  try {
    await execFileAsync(
      process.execPath,
      [path.join(packageRoot, 'bin', 'repoctopus.js'), ...args, '--json'],
      { cwd: workspace, env: environment },
    );
    throw new Error('Expected CLI command to fail');
  } catch (error) {
    const failure = error as { code?: number; stderr?: string };
    const envelope = JSON.parse(failure.stderr ?? '{}') as {
      diagnostics?: Array<{ message?: string }>;
    };
    return {
      ...(failure.code === undefined ? {} : { code: failure.code }),
      ...(envelope.diagnostics ? { diagnostics: envelope.diagnostics } : {}),
    };
  }
}

describe('specification approval CLI', () => {
  it('requires a current Run candidate and never fabricates standalone strategy defaults', async () => {
    const documentation = await readFile(
      path.join(packageRoot, 'docs', 'specification.md'),
      'utf8',
    );
    expect(documentation).toContain(
      'spec approval prepare --workspace . --run <run-id> --json',
    );
    expect(documentation).toContain(
      'run decision --workspace . --run <run-id> --json',
    );
    const selfHosting = await readFile(path.join(packageRoot, 'docs', 'self-hosting.md'), 'utf8');
    expect(selfHosting).toContain(
      '规划阶段只公开分支并取得绑定精确 OID 的规划批准，不创建 Change MR',
    );

    const root = await temporaryDirectory('repoctopus-specification-approval-cli-');
    cleanup.push(root);
    const remote = path.join(root, 'remote.git');
    await mkdir(remote);
    await execFileAsync('git', ['init', '--bare'], { cwd: remote });
    const workspace = await createGitRepository(root, 'workspace', remote);
    const environment = await createOpenSpecStoreEnvironment(root, workspace, 'specification-cli');
    await execFileAsync('git', ['push', '-u', 'origin', 'main'], { cwd: workspace });
    await execFileAsync('git', ['switch', '-c', 'spec/sample'], { cwd: workspace });
    await write(
      workspace,
      'repoctopus.yaml',
      JSON.stringify({
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'RepoctopusWorkspace',
        workspace: { id: 'specification-cli', repositoryId: 'workspace' },
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
          store: { id: 'specification-cli', repositoryId: 'workspace' },
        },
      }),
    );
    await write(workspace, '.gitignore', '.repoctopus/\n');
    await write(
      workspace,
      'openspec/specs/demo/spec.md',
      '# Demo Specification\n\n## Purpose\nDemo capability.\n\n## Requirements\n\n### Requirement: Existing behavior\nThe system MUST preserve existing behavior.\n\n#### Scenario: Existing action\n- **WHEN** the existing action runs\n- **THEN** it succeeds\n',
    );
    await writeChange(workspace, 'sample', true);
    await writeChange(workspace, 'invalid', false);
    await execFileAsync('git', ['add', '.'], { cwd: workspace });
    await execFileAsync('git', ['commit', '-m', 'spec: add planning fixtures'], { cwd: workspace });
    await execFileAsync('git', ['push', '-u', 'origin', 'spec/sample'], { cwd: workspace });
    await execFileAsync('git', ['branch', 'spec/unpublished'], { cwd: workspace });

    const missing = await runFailure(workspace, ['spec', 'approval', 'prepare', '--workspace', workspace], environment);
    expect(missing.code).toBe(1);
    expect(missing.diagnostics?.[0]?.message).toMatch(/--run/u);
    const started = await runCli<{ state: { runId: string; changeLifecycle: { phase: string; checkEpoch: number }; trigger: { facts: { buildStrategyPreference: unknown } } } }>({
      packageRoot, cwd: workspace, environment,
      args: ['run', 'start', '--workspace', workspace, '--change', 'sample', '--target', 'main'],
    });
    const runId = started.runId!;
    const premature = await runFailure(workspace, ['spec', 'approval', 'prepare', '--workspace', workspace, '--run', runId], environment);
    expect(premature.diagnostics?.[0]?.message).toMatch(/current complete Design proposal/u);
    const bypass = await runFailure(workspace, ['spec', 'approval', 'prepare', '--workspace', workspace, '--run', runId, '--tdd-mode', 'direct'], environment);
    expect(bypass.diagnostics?.[0]?.message).toMatch(/revise-strategy/u);
    const unchanged = await runCli<{ state: { changeLifecycle: { phase: string; checkEpoch: number }; trigger: { facts: { buildStrategyPreference: unknown } } } }>({
      packageRoot, cwd: workspace, environment, args: ['run', 'status', '--workspace', workspace, '--run', runId],
    });
    expect(unchanged.result!.state.changeLifecycle.phase).toBe('open');
    expect(unchanged.result!.state.changeLifecycle.checkEpoch).toBe(started.result!.state.changeLifecycle.checkEpoch);
    expect(unchanged.result!.state.trigger.facts.buildStrategyPreference).toEqual({ schemaVersion: 2 });
    const approval = await runCli({ packageRoot, cwd: workspace, environment,
      args: ['spec', 'approval', 'status', '--workspace', workspace, '--change', 'sample'] });
    expect(approval.result).toBeNull();
    const review = await runFailure(workspace, ['spec', 'approval', 'review', '--workspace', workspace, '--change', 'sample'], environment);
    expect(review.diagnostics?.[0]?.message).toMatch(/interactive terminal/iu);
  }, 30_000);
});