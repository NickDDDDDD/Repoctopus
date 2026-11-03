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
import { normalizeRemoteIdentity } from '../../platform/git/remote-identity.js';
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
  it('runs the documented branch-first flow and fails closed without trusted input', async () => {
    const documentation = await readFile(
      path.join(packageRoot, 'docs', 'specification.md'),
      'utf8',
    );
    expect(documentation).toContain(
      'spec approval prepare --workspace . --change <change-id> --branch spec/<change-id> --target main --json',
    );
    expect(documentation).toContain(
      'spec approval status --workspace . --change <change-id> --json',
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

    const prepared = await runCli<{
      status: string;
      snapshot: {
        artifacts: unknown[];
        buildStrategyDigest: string;
        changeBranch: { sourceBranch: string; remoteOid: string; remoteIdentity: string };
      };
    }>({
      packageRoot,
      cwd: workspace,
      args: [
        'spec',
        'approval',
        'prepare',
        '--workspace',
        workspace,
        '--change',
        'sample',
        '--branch',
        'spec/sample',
        '--target',
        'main',
      ],
      environment,
    });
    expect(prepared).toMatchObject({
      ok: true,
      command: 'spec approval prepare',
      result: {
        status: 'awaiting_approval',
        snapshot: { changeBranch: { sourceBranch: 'spec/sample' } },
      },
    });
    expect(prepared.result?.snapshot.artifacts).toHaveLength(4);
    expect(prepared.result?.snapshot.changeBranch.remoteOid).toMatch(/^[a-f0-9]{40}$/u);
    expect(prepared.result?.snapshot.changeBranch.remoteIdentity).toBe(
      normalizeRemoteIdentity(remote),
    );
    expect(prepared.result?.snapshot.buildStrategyDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);

    const status = await runCli({
      packageRoot,
      cwd: workspace,
      args: ['spec', 'approval', 'status', '--workspace', workspace, '--change', 'sample'],
      environment,
    });
    expect(status).toMatchObject({ result: { status: 'awaiting_approval', stateVersion: 0 } });

    const reviewFailure = await runFailure(
      workspace,
      ['spec', 'approval', 'review', '--workspace', workspace, '--change', 'sample'],
      environment,
    );
    expect(reviewFailure.code).toBe(1);
    expect(reviewFailure.diagnostics?.[0]?.message).toMatch(/interactive terminal/i);

    const unpublishedFailure = await runFailure(
      workspace,
      [
        'spec',
        'approval',
        'prepare',
        '--workspace',
        workspace,
        '--change',
        'sample',
        '--branch',
        'spec/unpublished',
        '--target',
        'main',
      ],
      environment,
    );
    expect(unpublishedFailure.code).toBe(1);
    expect(unpublishedFailure.diagnostics?.[0]?.message).toMatch(/not published/i);

    const invalidFailure = await runFailure(
      workspace,
      [
        'spec',
        'approval',
        'prepare',
        '--workspace',
        workspace,
        '--change',
        'invalid',
        '--branch',
        'spec/sample',
        '--target',
        'main',
      ],
      environment,
    );
    expect(invalidFailure.code).toBe(1);
    expect(invalidFailure.diagnostics?.[0]?.message).toMatch(/validation|strict/i);

    await write(
      workspace,
      'openspec/changes/sample/proposal.md',
      '# Change: sample\n\n## Why\nThis local edit has not been published.\n',
    );
    const dirtyFailure = await runFailure(
      workspace,
      [
        'spec',
        'approval',
        'prepare',
        '--workspace',
        workspace,
        '--change',
        'sample',
        '--branch',
        'spec/sample',
        '--target',
        'main',
      ],
      environment,
    );
    expect(dirtyFailure.code).toBe(1);
    expect(dirtyFailure.diagnostics?.[0]?.message).toMatch(/must be clean/i);
  }, 30_000);
});
