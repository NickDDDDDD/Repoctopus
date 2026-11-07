import { readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { afterEach, expect, it, vi } from 'vitest';
import { EvidenceCoordinator } from '../services/evidence-coordinator.js';
import { CompositionIdentity } from '../services/composition-identity.js';
import { FileRunStoreProvider } from '../plugins/run/file-run-store-provider.js';
import { EvidenceAdapters } from '../services/evidence-adapters.js';
import { RepositoryInputPolicies } from '../services/repository-input-policies.js';
import builtinHostInputPolicy from '../plugins/evidence/builtin-host-input-policy.js';
import { localCommandContributor } from '../plugins/evidence/local-adapter-contributors.js';
import { FileEvidenceJournal } from '../platform/evidence/file-evidence-journal.js';
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
