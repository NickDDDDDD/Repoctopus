import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { createProjectSnapshot } from '../../domains/project/snapshot.js';
import type { ProjectSnapshot } from '../../domains/project/types.js';
import { createWorkflowPackage } from '../../domains/workflow-contract/package.js';
import type { WorkflowPackage } from '../../domains/workflow-contract/types.js';

const execFileAsync = promisify(execFile);

export function workflowFixture(): WorkflowPackage {
  return createWorkflowPackage({
    apiVersion: 'repoctopus/v1alpha1',
    kind: 'Workflow',
    metadata: { name: 'test-flow', version: '1.0.0', description: 'test' },
    entry: 'inspect',
    steps: [
      {
        id: 'inspect',
        action: { type: 'checkpoint', ref: 'inspected', summary: 'inspect repositories' },
        onSuccess: 'verify',
        onFailure: 'inspect',
      },
      {
        id: 'verify',
        action: { type: 'checkpoint', ref: 'verified', summary: 'verify result' },
        onSuccess: null,
        onFailure: 'verify',
      },
    ],
    guardrails: {
      allowedActionTypes: ['checkpoint'],
      allowedRefs: ['inspected', 'verified'],
      confirmationRequiredFor: [],
      maxIterations: 10,
      maxRetriesPerAction: 2,
    },
  });
}

export function projectFixture(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return createProjectSnapshot({
    schemaVersion: 1,
    projectId: overrides.projectId ?? 'project-1',
    root: overrides.root ?? 'C:/project',
    capturedAt: overrides.capturedAt ?? '2026-01-01T00:00:00.000Z',
    repositories: overrides.repositories ?? [],
    diagnostics: overrides.diagnostics ?? [],
  });
}

export async function temporaryDirectory(prefix = 'repoctopus-test-'): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

export async function removeTemporaryDirectory(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}

export async function createGitRepository(
  root: string,
  name: string,
  remote?: string,
): Promise<string> {
  const repository = path.join(root, name);
  await mkdir(repository, { recursive: true });
  await execFileAsync('git', ['init', '--initial-branch=main'], { cwd: repository });
  await execFileAsync('git', ['config', 'user.name', 'Repoctopus Test'], { cwd: repository });
  await execFileAsync('git', ['config', 'user.email', 'repoctopus@example.invalid'], {
    cwd: repository,
  });
  await writeFile(path.join(repository, 'README.md'), `# ${name}\n`);
  await execFileAsync('git', ['add', 'README.md'], { cwd: repository });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: repository });
  if (remote) await execFileAsync('git', ['remote', 'add', 'origin', remote], { cwd: repository });
  return repository;
}
