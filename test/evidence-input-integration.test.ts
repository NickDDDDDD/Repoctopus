import { readFile, writeFile, unlink, symlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { afterEach, expect, it, vi } from 'vitest';
import { EvidenceCoordinator } from '../services/evidence-coordinator.js';
import type { RunState } from '../domains/engine/types.js';
import { CompositionIdentity } from '../services/composition-identity.js';
import { FileRunStoreProvider } from '../plugins/run/file-run-store-provider.js';
import { EvidenceAdapters } from '../services/evidence-adapters.js';
import { RepositoryInputPolicies } from '../services/repository-input-policies.js';
import builtinHostInputPolicy from '../plugins/evidence/builtin-host-input-policy.js';
import { localCommandContributor } from '../plugins/evidence/local-adapter-contributors.js';
import { FileEvidenceJournal } from '../platform/evidence/file-evidence-journal.js';
import { FileEvidenceInputProofs } from '../platform/evidence/file-input-proofs.js';
import { FileArtifactStore } from '../platform/evidence/file-artifact-store.js';
import { parseEvidenceInputPolicy } from '../domains/evidence/input-policy.js';
import type {
  SharedProjectConfig,
  CommandNodeConfig,
} from '../domains/project-configuration/types.js';
import {
  compositionFixture,
  createGitRepository,
  temporaryDirectory,
  removeTemporaryDirectory,
} from './helpers/fixtures.js';

const cleanup: string[] = [];
const contexts: Context[] = [];
const git = promisify(execFile);
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(contexts.splice(0).map((ctx) => ctx.fiber.dispose()));
  await Promise.all(cleanup.splice(0).map(removeTemporaryDirectory));
});
async function boot(workspace: string) {
  const context = new Context();
  contexts.push(context);
  new CompositionIdentity(context, compositionFixture());
  new FileRunStoreProvider(context, { workspaceRoot: workspace });
  new EvidenceAdapters(context);
  new RepositoryInputPolicies(context);
  await context.plugin(builtinHostInputPolicy);
  await context.plugin(localCommandContributor);
  await context.plugin(EvidenceCoordinator, { workspaceRoot: workspace });
  return context.evidenceCoordinator;
}
async function fixture() {
  const root = await temporaryDirectory('evidence-input-dag-');
  cleanup.push(root);
  const workspace = await createGitRepository(root, 'workspace');
  const app = await createGitRepository(root, 'app');
  const countFile = path.join(root, 'executions.log');
  await writeFile(countFile, '');
  await writeFile(path.join(app, 'a.txt'), 'one');
  await writeFile(path.join(app, 'b.txt'), 'independent');
  await writeFile(
    path.join(app, 'runner.mjs'),
    `import fs from 'node:fs';
const [id,count]=process.argv.slice(2);fs.appendFileSync(count,id+'\\n');
if(id==='a'){fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/value.txt',fs.readFileSync('a.txt'));}
if(id==='b'&&!fs.readFileSync('b.txt','utf8'))throw Error('empty independent input');
if(id==='c'&&!fs.readFileSync('dist/value.txt','utf8'))throw Error('missing derived input');
`,
  );
  const command = (
    id: string,
    files: string[],
    outputs: string[] = [],
    dependsOn: string[] = [],
  ): CommandNodeConfig => ({
    id,
    type: 'command',
    repository: 'app',
    dependsOn,
    required: true,
    cache: true,
    cacheTtlMs: 120_000,
    executable: process.execPath,
    args: ['runner.mjs', id, countFile],
    timeoutMs: 5000,
    inputs: parseEvidenceInputPolicy({
      schemaVersion: 1,
      repositories: [{ repository: 'app', files, outputs }],
    }),
  });
  const config: SharedProjectConfig = {
    apiVersion: 'repoctopus/v1alpha1',
    kind: 'RepoctopusWorkspace',
    workspace: { id: 'input-dag', repositoryId: 'workspace' },
    repositories: [
      { id: 'workspace', path: '.' },
      { id: 'app', path: '../app' },
    ],
    profiles: [
      {
        id: 'verify',
        nodes: [
          command('a', ['a.txt', 'runner.mjs'], ['dist/**']),
          command('b', ['b.txt', 'runner.mjs']),
          command('c', ['dist/**', 'runner.mjs'], [], ['a']),
        ],
      },
    ],
  };
  await writeFile(path.join(workspace, 'repoctopus.yaml'), JSON.stringify(config));
  const counts = async () => (await readFile(countFile, 'utf8')).trim().split('\n').filter(Boolean);
  return { workspace, app, counts };
}

it('revalidates selected receipts against real files and derived bytes without whole-Bundle invalidation', async () => {
  const { workspace, app, counts } = await fixture();
  const evidence = await boot(workspace);
  const first = await evidence.run('verify', 'selected-inputs');
  const originalStatus = evidence.status.bind(evidence);
  vi.spyOn(evidence, 'status').mockImplementation(async (id) => {
    const status = await originalStatus(id);
    return {
      ...status,
      context: {
        ...status.context,
        workflowBinding: {
          workflowRunId: 'selected-run',
          workflowActionId: 'selected-work',
          workflowStepId: 'verify',
        },
      },
    };
  });
  vi.spyOn(contexts.at(-1)!.runStore, 'loadRun').mockResolvedValue({
    runId: 'selected-run',
  } as RunState);
  const b = first.receipts.find((r) => r.nodeId === 'b')!.receiptId;
  const c = first.receipts.find((r) => r.nodeId === 'c')!.receiptId;
  await writeFile(path.join(app, 'a.txt'), 'changed implementation A');
  expect(
    (await evidence.assessSelectedReceiptInputs('selected-inputs', 'selected-run', [b]))[b],
  ).toBe('same');
  expect(
    (await evidence.assessSelectedReceiptInputs('selected-inputs', 'selected-run', [c]))[c],
  ).toBe('drift');
  await writeFile(path.join(app, 'a.txt'), 'one');
  await writeFile(path.join(app, 'dist', 'value.txt'), 'tampered derived bytes');
  expect(
    (await evidence.assessSelectedReceiptInputs('selected-inputs', 'selected-run', [b]))[b],
  ).toBe('same');
  expect(
    (await evidence.assessSelectedReceiptInputs('selected-inputs', 'selected-run', [c]))[c],
  ).toBe('drift');
  expect(await evidence.assessSelectedReceiptInputs('does-not-exist', 'selected-run', [])).toEqual(
    {},
  );
  expect(await counts()).toHaveLength(3);
});

it('persists actual DAG proofs, reuses only affected content and rebuilds missing producer outputs', async () => {
  const { workspace, app, counts } = await fixture();
  let evidence = await boot(workspace);
  const first = await evidence.run('verify', 'first');
  expect(first.bundle.outcome).toBe('passed');
  expect((await counts()).sort()).toEqual(['a', 'b', 'c']);
  expect(first.receipts.map((r) => r.inputFingerprint)).not.toContain(
    first.bundle.inputFingerprint,
  );
  expect(first.receipts.find((r) => r.nodeId === 'a')!.outputManifest?.artifactType).toBe(
    'evidence-output-manifest',
  );
  const c = first.receipts.find((r) => r.nodeId === 'c')!;
  expect(c.derivedInputs[0]!.producerReceiptId).toBe(
    first.receipts.find((r) => r.nodeId === 'a')!.receiptId,
  );
  evidence = await boot(workspace);
  const second = await evidence.run('verify', 'second');
  expect(second.bundle.outcome).toBe('passed');
  expect(second.receipts.every((r) => r.freshness === 'reused')).toBe(true);
  expect(await counts()).toHaveLength(3);
  await writeFile(path.join(app, 'a.txt'), 'two');
  const third = await evidence.run('verify', 'third');
  expect(third.bundle.outcome).toBe('passed');
  expect(Object.fromEntries(third.receipts.map((r) => [r.nodeId, r.freshness]))).toEqual({
    a: 'fresh',
    b: 'reused',
    c: 'fresh',
  });
  expect(await counts()).toHaveLength(5);
  await unlink(path.join(app, 'dist', 'value.txt'));
  const fourth = await evidence.run('verify', 'fourth');
  expect(fourth.bundle.outcome).toBe('passed');
  expect(Object.fromEntries(fourth.receipts.map((r) => [r.nodeId, r.freshness]))).toEqual({
    a: 'fresh',
    b: 'reused',
    c: 'reused',
  });
  expect(await counts()).toHaveLength(6);
}, 60_000);

it('does not replay an unknown producer or reuse a Receipt without its completion Journal entry', async () => {
  const { workspace, app, counts } = await fixture();
  const evidence = await boot(workspace);
  const original = FileEvidenceJournal.prototype.recordCompletion.bind(
    new FileEvidenceJournal(workspace),
  );
  const fault = vi
    .spyOn(FileEvidenceJournal.prototype, 'recordCompletion')
    .mockImplementation(async (attempt, node, ...args) => {
      if (attempt === 'interrupted' && node === 'a')
        throw new Error('interrupted between Receipt and Journal commit');
      return original(attempt, node, ...args);
    });
  await expect(evidence.run('verify', 'interrupted')).rejects.toThrow(
    'interrupted between Receipt and Journal commit',
  );
  fault.mockRestore();
  const before = (await counts()).length;
  const resumed = await (await boot(workspace)).resume('interrupted');
  expect(resumed.bundle?.outcome).toBe('incomplete');
  expect(await counts()).toHaveLength(before);
  const fresh = await (await boot(workspace)).run('verify', 'fresh');
  expect(fresh.bundle.outcome).toBe('passed');
  expect(fresh.receipts.find((r) => r.nodeId === 'a')!.freshness).toBe('fresh');
  expect(fresh.receipts.find((r) => r.nodeId === 'c')!.freshness).toBe('fresh');
  expect((await counts()).filter((id) => id === 'a')).toHaveLength(2);
  expect(await readFile(path.join(app, 'dist', 'value.txt'), 'utf8')).toBe('one');
}, 60_000);

it('binds only declared environment and Git inputs using the production observer', async () => {
  const { workspace, app } = await fixture();
  const file = path.join(workspace, 'repoctopus.yaml');
  const config = JSON.parse(await readFile(file, 'utf8')) as SharedProjectConfig;
  const nodes = config.profiles[0]!.nodes as CommandNodeConfig[];
  nodes[0]!.inputs!.env = ['REPOCTOPUS_EVIDENCE_TEST_CHANNEL'];
  nodes[1]!.inputs!.git = 'all';
  await writeFile(file, JSON.stringify(config));
  const beforeEnv = process.env.REPOCTOPUS_EVIDENCE_TEST_CHANNEL;
  try {
    process.env.REPOCTOPUS_EVIDENCE_TEST_CHANNEL = 'first';
    const evidence = await boot(workspace);
    const snapshots = async () =>
      Object.fromEntries(
        (await evidence.plan('verify')).fingerprint.manifest.nodeInputs.map((node) => [
          node.nodeId,
          node.fingerprint,
        ]),
      );
    const first = await snapshots();
    process.env.REPOCTOPUS_EVIDENCE_TEST_CHANNEL = 'second';
    const second = await snapshots();
    expect(second.a).not.toBe(first.a);
    expect(second.b).toBe(first.b);
    await git('git', ['add', '.'], { cwd: app });
    await git('git', ['commit', '-m', 'same effective input bytes'], { cwd: app });
    const third = await snapshots();
    expect(third.a).toBe(second.a);
    expect(third.b).not.toBe(second.b);
  } finally {
    if (beforeEnv === undefined) delete process.env.REPOCTOPUS_EVIDENCE_TEST_CHANNEL;
    else process.env.REPOCTOPUS_EVIDENCE_TEST_CHANNEL = beforeEnv;
  }
}, 60_000);

it('rejects a persisted Receipt whose canonical dependency proof was removed', async () => {
  const { workspace, counts } = await fixture();
  const evidence = await boot(workspace);
  const result = await evidence.run('verify', 'corrupt-proof');
  const receipt = result.receipts[0]!;
  const withoutProof: Partial<typeof receipt> = { ...receipt };
  delete withoutProof.dependencies;
  await writeFile(
    path.join(workspace, '.repoctopus', 'evidence', 'receipts', `${receipt.receiptId}.json`),
    JSON.stringify(withoutProof),
  );
  await expect((await boot(workspace)).status('corrupt-proof')).rejects.toThrow(/dependency/u);
  expect(await counts()).toHaveLength(3);
}, 60_000);

it('does not resurrect a superseded node when its source is restored, but preserves independent receipts', async () => {
  const { workspace, app, counts } = await fixture();
  // Preserve the original receiver in the fault-injection wrapper below.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const capture = FileEvidenceInputProofs.prototype.captureOutputs;
  const fault = vi
    .spyOn(FileEvidenceInputProofs.prototype, 'captureOutputs')
    .mockImplementation(async function (this: FileEvidenceInputProofs, snapshot) {
      const result = await capture.call(this, snapshot);
      if (snapshot.nodeId === 'a')
        await writeFile(path.join(app, 'a.txt'), 'changed during execution');
      return result;
    });
  const first = await (await boot(workspace)).run('verify', 'drifted');
  fault.mockRestore();
  expect(first.bundle.checks.find((check) => check.nodeId === 'a')!.freshness).toBe('superseded');
  await writeFile(path.join(app, 'a.txt'), 'one');
  const restored = await (await boot(workspace)).run('verify', 'restored');
  expect(restored.receipts.find((receipt) => receipt.nodeId === 'a')!.freshness).toBe('fresh');
  expect(restored.receipts.find((receipt) => receipt.nodeId === 'b')!.freshness).toBe('reused');
  expect((await counts()).filter((id) => id === 'a')).toHaveLength(2);
}, 60_000);

it('does not accept or cache a producer that never created its declared outputs', async () => {
  const { workspace, counts } = await fixture();
  const file = path.join(workspace, 'repoctopus.yaml');
  const config = JSON.parse(await readFile(file, 'utf8')) as SharedProjectConfig;
  const node = config.profiles[0]!.nodes[1]! as CommandNodeConfig;
  node.inputs!.repositories![0]!.outputs = ['missing/**'];
  config.profiles[0]!.nodes = [node];
  await writeFile(file, JSON.stringify(config));
  const evidence = await boot(workspace);
  const first = await evidence.run('verify', 'missing-first');
  expect(first.bundle.outcome).toBe('incomplete');
  const second = await evidence.run('verify', 'missing-second');
  expect(second.receipts[0]!.freshness).toBe('fresh');
  expect(await counts()).toHaveLength(2);
}, 60_000);

it.skipIf(process.platform === 'win32')(
  'resolves a normal Unix symlink launcher and binds its real program',
  async () => {
    const { workspace, app } = await fixture();
    const launcher = path.join(app, 'node-launcher');
    await symlink(process.execPath, launcher);
    const file = path.join(workspace, 'repoctopus.yaml');
    const config = JSON.parse(await readFile(file, 'utf8')) as SharedProjectConfig;
    const node = config.profiles[0]!.nodes[0]! as CommandNodeConfig;
    node.executable = launcher;
    config.profiles[0]!.nodes = [node];
    await writeFile(file, JSON.stringify(config));
    expect(
      (await (await boot(workspace)).plan('verify')).fingerprint.manifest.nodeInputs[0]!.cacheable,
    ).toBe(true);
  },
  60_000,
);

it('keeps a producer unknown when interrupted before its manifest is committed', async () => {
  const { workspace, counts } = await fixture();
  const artifacts = new FileArtifactStore(workspace);
  const put = artifacts.put.bind(artifacts);
  const fault = vi
    .spyOn(FileArtifactStore.prototype, 'put')
    .mockImplementation((bytes, options) => {
      if (options.artifactType === 'evidence-output-manifest')
        throw new Error('before manifest commit');
      return put(bytes, options);
    });
  await expect((await boot(workspace)).run('verify', 'before-manifest')).rejects.toThrow(
    'before manifest commit',
  );
  fault.mockRestore();
  const before = await counts();
  const resumed = await (await boot(workspace)).resume('before-manifest');
  expect(resumed.bundle?.outcome).toBe('incomplete');
  expect(await counts()).toEqual(before);
}, 60_000);

it('rejects changed Bundle freshness under its original identity before cache selection', async () => {
  const { workspace, counts } = await fixture();
  const result = await (await boot(workspace)).run('verify', 'bundle-identity');
  const changed = structuredClone(result.bundle);
  changed.checks[0]!.freshness = 'reused';
  await writeFile(
    path.join(workspace, '.repoctopus', 'evidence', 'bundles', `${changed.bundleId}.json`),
    JSON.stringify(changed),
  );
  const restarted = await boot(workspace);
  await expect(restarted.status('bundle-identity')).rejects.toThrow(/identity/u);
  await expect(restarted.run('verify', 'after-corruption')).rejects.toThrow(/identity/u);
  expect(await counts()).toHaveLength(3);
}, 60_000);

it('recovers a committed producer completion without executing it again after interruption', async () => {
  const { workspace, counts } = await fixture();
  const journal = new FileEvidenceJournal(workspace);
  const complete = journal.recordCompletion.bind(journal);
  const fault = vi
    .spyOn(FileEvidenceJournal.prototype, 'recordCompletion')
    .mockImplementation(async (attempt, node, ...rest) => {
      await complete(attempt, node, ...rest);
      if (node === 'a') throw new Error('after completion commit');
    });
  await expect((await boot(workspace)).run('verify', 'after-completion')).rejects.toThrow(
    'after completion commit',
  );
  fault.mockRestore();
  const resumed = await (await boot(workspace)).resume('after-completion');
  // Resume reconstructs committed facts; it does not silently run the pending consumer.
  expect(resumed.bundle?.checks.find((check) => check.nodeId === 'a')).toMatchObject({
    status: 'passed',
  });
  expect(resumed.bundle?.outcome).toBe('incomplete');
  expect((await counts()).filter((id) => id === 'a')).toHaveLength(1);
  expect((await counts()).sort()).toEqual(['a', 'b']);
}, 60_000);
