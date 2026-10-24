import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { stringify } from 'yaml';

import { createProjectSnapshot } from '../../domains/project/snapshot.js';
import type { ProjectSnapshot } from '../../domains/project/types.js';
import { createWorkflowPackage } from '../../domains/workflow-contract/package.js';
import type { WorkflowPackage } from '../../domains/workflow-contract/types.js';
import type { CompositionIdentitySnapshot } from '../../domains/composition/types.js';
import type {
  SpecificationProviderIdentity,
  SpecificationSchemaInstructions,
} from '../../domains/specification/types.js';
import { canonicalJson } from '../../domains/workflow-contract/canonical.js';

const execFileAsync = promisify(execFile);
export const TEST_COMPOSITION_DIGEST = `sha256:${'c'.repeat(64)}` as const;

export function specificationSchemaFixture(
  provider: SpecificationProviderIdentity = {
    id: 'openspec',
    version: '1.14.3',
    protocolVersion: 'repoctopus.specification/v1alpha1',
  },
): SpecificationSchemaInstructions {
  const stable = {
    schemaVersion: 1 as const,
    schemaName: 'spec-driven',
    provider: structuredClone(provider),
    artifacts: [
      { id: 'proposal', kind: 'proposal' as const },
      { id: 'specs', kind: 'delta-specs' as const },
      { id: 'design', kind: 'design' as const },
      { id: 'tasks', kind: 'tasks' as const },
    ].map((artifact, index) => ({
      ...artifact,
      instructionDigest: `sha256:${String(index + 1).repeat(64)}` as const,
      templateDigest: `sha256:${String(index + 5).repeat(64)}` as const,
    })),
  };
  return {
    ...stable,
    digest: `sha256:${createHash('sha256').update(canonicalJson(stable)).digest('hex')}`,
  };
}

export function compositionFixture(
  overrides: Partial<CompositionIdentitySnapshot> = {},
): CompositionIdentitySnapshot {
  return {
    id: overrides.id ?? 'test-composition',
    kind: overrides.kind ?? 'project',
    compositionDigest: overrides.compositionDigest ?? TEST_COMPOSITION_DIGEST,
    plugins: overrides.plugins ?? [],
  };
}

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
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

export async function createOpenSpecStoreEnvironment(
  fixtureRoot: string,
  storeRoot: string,
  storeId: string,
): Promise<NodeJS.ProcessEnv> {
  const dataRoot = path.join(fixtureRoot, '.openspec-test-data');
  const configRoot = path.join(fixtureRoot, '.openspec-test-config');
  await Promise.all([
    mkdir(path.join(storeRoot, 'openspec', 'specs'), { recursive: true }),
    mkdir(path.join(storeRoot, 'openspec', 'changes', 'archive'), { recursive: true }),
    mkdir(path.join(storeRoot, '.openspec-store'), { recursive: true }),
    mkdir(path.join(dataRoot, 'openspec', 'stores'), { recursive: true }),
    mkdir(path.join(configRoot, 'openspec'), { recursive: true }),
  ]);
  const openspecConfig = path.join(storeRoot, 'openspec', 'config.yaml');
  const configExists = await access(openspecConfig).then(
    () => true,
    () => false,
  );
  await Promise.all([
    ...(configExists ? [] : [writeFile(openspecConfig, 'schema: spec-driven\n')]),
    writeFile(
      path.join(storeRoot, '.openspec-store', 'store.yaml'),
      stringify({ version: 1, id: storeId }),
    ),
    writeFile(
      path.join(dataRoot, 'openspec', 'stores', 'registry.yaml'),
      stringify({
        version: 1,
        stores: { [storeId]: { backend: { type: 'git', local_path: storeRoot } } },
      }),
    ),
    writeFile(
      path.join(configRoot, 'openspec', 'config.json'),
      `${JSON.stringify({ defaultStore: 'must-not-override-explicit-store' })}\n`,
    ),
  ]);
  return {
    ...process.env,
    XDG_DATA_HOME: dataRoot,
    XDG_CONFIG_HOME: configRoot,
    OPENSPEC_NO_UPDATE_CHECK: '1',
    OPENSPEC_TELEMETRY: '0',
  };
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

export async function commitGitRepository(repository: string, message: string): Promise<void> {
  await execFileAsync('git', ['add', '.'], { cwd: repository });
  await execFileAsync('git', ['commit', '-m', message], { cwd: repository });
}
