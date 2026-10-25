import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import type { SpecificationClosurePlan } from '../domains/specification/types.js';
import { GitSpecificationCheckoutManager } from '../platform/git/specification-checkout.js';
import { FileSpecificationClosureJournalStore } from '../platform/specification/file-closure-journal-store.js';
import {
  IsolatedSpecificationClosureTransaction,
  type SpecificationClosureFaultPoint,
} from '../platform/specification/isolated-closure-transaction.js';

const exec = promisify(execFile);
const roots: string[] = [];
const digest = (character: string) => `sha256:${character.repeat(64)}` as const;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'repoctopus-closure-'));
  roots.push(root);
  await mkdir(path.join(root, 'openspec', 'changes', 'isolated-close'), { recursive: true });
  await mkdir(path.join(root, 'openspec', 'specs', 'archive'), { recursive: true });
  await writeFile(path.join(root, '.gitignore'), '.repoctopus/\n', 'utf8');
  await writeFile(
    path.join(root, 'openspec', 'changes', 'isolated-close', 'proposal.md'),
    '# Proposal\n',
    'utf8',
  );
  await writeFile(
    path.join(root, 'openspec', 'specs', 'archive', 'spec.md'),
    '# Archive\n',
    'utf8',
  );
  await exec('git', ['init', '-b', 'main'], { cwd: root });
  await exec('git', ['config', 'user.name', 'Test'], { cwd: root });
  await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  await exec('git', ['add', '.'], { cwd: root });
  await exec('git', ['commit', '-m', 'initial'], { cwd: root });
  return root;
}

const plan: SpecificationClosurePlan = {
  apiVersion: 'repoctopus.specification/v1alpha1',
  kind: 'SpecificationClosurePlan',
  changeId: 'isolated-close',
  provider: {
    id: 'openspec',
    version: '1.14.3',
    protocolVersion: 'repoctopus.specification/v1alpha1',
  },
  changeDigest: digest('1'),
  mergeFactsDigest: digest('2'),
  targetBaselineDigest: digest('3'),
  affectedCapabilities: ['archive'],
  retiredCapabilities: [],
  allowedPathPrefixes: ['openspec/changes', 'openspec/specs'],
  planDigest: digest('4'),
};

async function officialArchive(checkoutRoot: string) {
  const archiveId = '2026-10-24-isolated-close';
  const archiveParent = path.join(checkoutRoot, 'openspec', 'changes', 'archive');
  await mkdir(archiveParent, { recursive: true });
  await rename(
    path.join(checkoutRoot, 'openspec', 'changes', 'isolated-close'),
    path.join(archiveParent, archiveId),
  );
  await writeFile(
    path.join(checkoutRoot, 'openspec', 'specs', 'archive', 'spec.md'),
    '# Archive\n\n## Requirements\n',
    'utf8',
  );
  return closureResult();
}

function closureResult() {
  const archiveId = '2026-10-24-isolated-close';
  return {
    apiVersion: 'repoctopus.specification/v1alpha1' as const,
    kind: 'SpecificationClosureResult' as const,
    changeId: plan.changeId,
    provider: plan.provider,
    planDigest: plan.planDigest,
    closureId: digest('5'),
    status: 'closed' as const,
    archiveId,
    changedFiles: [
      `openspec/changes/archive/${archiveId}/proposal.md`,
      'openspec/changes/isolated-close/proposal.md',
      'openspec/specs/archive/spec.md',
    ],
  };
}

describe('isolated Specification closure transaction', () => {
  it.each([
    ['after-prepared', 'prepared', false],
    ['after-command', 'applying', true],
    ['before-receipt', 'applying', true],
  ] as const)(
    'persists an explainable %s fault without changing the developer tree',
    async (fault, expectedState, commandRan) => {
      const root = await repository();
      const statusBefore = (await exec('git', ['status', '--porcelain=v1'], { cwd: root })).stdout;
      const store = new FileSpecificationClosureJournalStore(root);
      const manager = new GitSpecificationCheckoutManager(root);
      let ran = false;
      const transaction = new IsolatedSpecificationClosureTransaction(
        store,
        manager,
        async (checkout, closurePlan) => {
          ran = true;
          expect(closurePlan.planDigest).toBe(plan.planDigest);
          return officialArchive(checkout);
        },
        (point: SpecificationClosureFaultPoint) => {
          if (point === fault) throw new Error(`fault:${point}`);
        },
      );
      await expect(transaction.execute(plan)).rejects.toThrow(`fault:${fault}`);
      expect(ran).toBe(commandRan);
      const journal = await store.load(plan.planDigest);
      expect(journal?.state).toBe(expectedState);
      const checkout = await manager.find(journal!.checkoutId);
      expect(checkout).not.toBeNull();
      expect(
        await readFile(
          path.join(root, 'openspec', 'changes', 'isolated-close', 'proposal.md'),
          'utf8',
        ),
      ).toBe('# Proposal\n');
      const statusAfter = (await exec('git', ['status', '--porcelain=v1'], { cwd: root })).stdout;
      expect(statusAfter).toBe(statusBefore);
      const recovery = new IsolatedSpecificationClosureTransaction(
        store,
        manager,
        async (candidate) => {
          ran = true;
          return officialArchive(candidate);
        },
        undefined,
        async (candidate) => {
          expect(
            (
              await readFile(
                path.join(
                  candidate,
                  'openspec',
                  'changes',
                  'archive',
                  closureResult().archiveId,
                  'proposal.md',
                ),
                'utf8',
              )
            ).replaceAll('\r\n', '\n'),
          ).toBe('# Proposal\n');
          return closureResult();
        },
      );
      await expect(recovery.execute(plan)).resolves.toMatchObject({
        result: { closureId: digest('5') },
      });
      expect(await store.load(plan.planDigest)).toMatchObject({ state: 'committed' });
      await manager.cleanup(checkout!);
    },
  );

  it('commits the journal only after the official archive returns a Closure Receipt', async () => {
    const root = await repository();
    const store = new FileSpecificationClosureJournalStore(root);
    const manager = new GitSpecificationCheckoutManager(root);
    let executions = 0;
    const transaction = new IsolatedSpecificationClosureTransaction(
      store,
      manager,
      async (checkout) => {
        executions += 1;
        return officialArchive(checkout);
      },
    );
    const result = await transaction.execute(plan);
    expect(result.result.closureId).toBe(digest('5'));
    expect(await store.load(plan.planDigest)).toMatchObject({
      state: 'committed',
      resultClosureId: digest('5'),
    });
    expect((await exec('git', ['status', '--porcelain=v1'], { cwd: root })).stdout).toBe('');
    const replay = await transaction.execute(plan);
    expect(replay.result).toEqual(result.result);
    expect(executions).toBe(1);
    const archives = await readFile(
      path.join(
        result.checkout.root,
        'openspec',
        'changes',
        'archive',
        result.result.archiveId,
        'proposal.md',
      ),
      'utf8',
    );
    expect(archives.replaceAll('\r\n', '\n')).toBe('# Proposal\n');
    await manager.cleanup(result.checkout);
  });
});
