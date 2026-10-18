import { mkdir, utimes } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { recoverEvidenceAttempt } from '../../domains/evidence/recovery.js';
import { EvidenceService } from '../../domains/evidence/service.js';
import type { CommandAdapter, CommandResult } from '../../domains/feedback/ports.js';
import type { EvidenceExecutionPlan, PlannedEvidenceNode } from '../../domains/feedback/profile.js';
import { FileArtifactStore } from '../../platform/evidence/file-artifact-store.js';
import { FileEvidenceJournal } from '../../platform/evidence/file-evidence-journal.js';
import { FileEvidenceStore } from '../../platform/evidence/file-evidence-store.js';
import { FileEvidenceRetention } from '../../platform/evidence/retention.js';
import {
  FileResourceLeaseManager,
  ResourceLeaseConflictError,
} from '../../platform/runtime/resource-lease.js';
import { removeTemporaryDirectory, temporaryDirectory } from '../helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

function commandNode(
  id: string,
  repositoryPath: string,
  options: { dependsOn?: string[]; required?: boolean; cache?: boolean } = {},
): Extract<PlannedEvidenceNode, { type: 'command' }> {
  return {
    id,
    type: 'command',
    repository: id,
    repositoryPath,
    dependsOn: options.dependsOn ?? [],
    required: options.required ?? true,
    executable: id,
    args: [],
    timeoutMs: 1000,
    cache: options.cache ?? false,
  };
}

function plan(nodes: PlannedEvidenceNode[]): EvidenceExecutionPlan {
  return {
    schemaVersion: 1,
    profileId: 'synthetic-multi-repo',
    configDigest: 'config',
    nodes,
    order: nodes.map((node) => node.id),
  };
}

function result(exitCode = 0): CommandResult {
  return {
    exitCode,
    stdout: exitCode === 0 ? 'ok' : '',
    stderr: exitCode === 0 ? '' : 'failed',
    timedOut: false,
    stdoutBytes: exitCode === 0 ? 2 : 0,
    stderrBytes: exitCode === 0 ? 0 : 6,
    stdoutTruncated: false,
    stderrTruncated: false,
  };
}

function stores(workspace: string, adapter: CommandAdapter, journal?: FileEvidenceJournal) {
  const artifacts = new FileArtifactStore(workspace);
  const store = new FileEvidenceStore(workspace);
  return {
    artifacts,
    store,
    service: new EvidenceService(artifacts, store, adapter, undefined, journal),
  };
}

describe('synthetic multi-repository Evidence product flow', () => {
  it('runs independent repositories in parallel, exposes all four outcomes and never retries business failure', async () => {
    const workspace = await temporaryDirectory('repoctopus-synthetic-dag-');
    cleanup.push(workspace);
    const repositories = await Promise.all(
      ['front', 'plugin', 'design', 'backend'].map(async (id) => {
        const directory = path.join(workspace, id);
        await mkdir(directory);
        return directory;
      }),
    );
    let active = 0;
    let maximum = 0;
    const calls = new Map<string, number>();
    const adapter: CommandAdapter = {
      run: async (request) => {
        calls.set(request.executable, (calls.get(request.executable) ?? 0) + 1);
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 40));
        active -= 1;
        return result(request.executable === 'fail' ? 2 : 0);
      },
    };
    const { service } = stores(workspace, adapter);
    const passed = await service.run(
      plan([
        commandNode('front', repositories[0]!),
        commandNode('plugin', repositories[1]!),
        commandNode('design', repositories[2]!),
        commandNode('backend', repositories[3]!),
      ]),
      'passed',
    );
    expect(passed.bundle.outcome).toBe('passed');
    expect(maximum).toBeGreaterThan(1);
    active = 0;
    maximum = 0;
    await service.run(
      plan([
        commandNode('serial-front', repositories[0]!),
        commandNode('serial-backend', repositories[3]!),
      ]),
      'limited',
      { maxParallel: 1 },
    );
    expect(maximum).toBe(1);

    const failed = await service.run(
      plan([
        { ...commandNode('fail', repositories[0]!), executable: 'fail' },
        commandNode('blocked', repositories[1]!, { dependsOn: ['fail'] }),
        commandNode('independent', repositories[2]!),
      ]),
      'failed',
    );
    expect(failed.bundle.outcome).toBe('failed');
    expect(failed.bundle.checks).toContainEqual(
      expect.objectContaining({ nodeId: 'blocked', status: 'blocked' }),
    );
    expect(calls.get('fail')).toBe(1);

    const warning = await service.run(
      plan([
        commandNode('required', repositories[0]!),
        {
          ...commandNode('optional-failure', repositories[1]!, { required: false }),
          executable: 'fail',
        },
      ]),
      'warning',
    );
    expect(warning.bundle.outcome).toBe('passed_with_warnings');

    const incomplete = await service.run(
      plan([
        {
          id: 'browser',
          type: 'browser',
          repository: 'front',
          repositoryPath: repositories[0]!,
          dependsOn: [],
          required: true,
          source: 'managed',
          journey: {
            apiVersion: 'repoctopus/v1alpha1',
            kind: 'BrowserJourney',
            journeyId: 'missing-browser',
            viewport: { width: 1280, height: 720 },
            timeoutMs: 1000,
            actions: [{ type: 'assertVisible', selector: 'main' }],
          },
        },
      ]),
      'incomplete',
    );
    expect(incomplete.bundle.outcome).toBe('incomplete');
  });

  it('reuses only eligible receipts, invalidates drift and recovers committed facts after interruption', async () => {
    const workspace = await temporaryDirectory('repoctopus-synthetic-recovery-');
    cleanup.push(workspace);
    let calls = 0;
    const adapter: CommandAdapter = {
      run: () => {
        calls += 1;
        return Promise.resolve(result());
      },
    };
    const journal = new FileEvidenceJournal(workspace);
    const { service, store } = stores(workspace, adapter, journal);
    const cachedPlan = plan([commandNode('cached', workspace, { cache: true })]);
    const first = await service.run(cachedPlan, 'same');
    const reused = await service.run(cachedPlan, 'same', { reusableReceipts: first.receipts });
    expect(calls).toBe(1);
    expect(reused.receipts[0]).toMatchObject({
      freshness: 'reused',
      sourceReceiptId: first.receipts[0]?.receiptId,
    });

    const drifted = await service.run(cachedPlan, 'before', {
      captureEndingFingerprint: () => Promise.resolve('after'),
    });
    expect(drifted.attempt.status).toBe('superseded');
    expect(drifted.bundle.outcome).toBe('incomplete');

    let interruptedAttempt = '';
    await expect(
      service.run(plan([commandNode('crash', workspace)]), 'crash', {
        afterNodeCommitted: (receipt) => {
          interruptedAttempt = receipt.attemptId;
          throw new Error('power loss');
        },
      }),
    ).rejects.toThrow('power loss');
    const beforeRecoveryCalls = calls;
    const recovered = await recoverEvidenceAttempt({
      attemptId: interruptedAttempt,
      plan: plan([commandNode('crash', workspace)]),
      store,
      journal,
      timestamp: '2026-10-18T00:00:00.000Z',
    });
    expect(recovered.bundle.outcome).toBe('passed');
    expect(calls).toBe(beforeRecoveryCalls);
  });

  it('rejects lease conflicts and cleans only unreferenced artifacts', async () => {
    const workspace = await temporaryDirectory('repoctopus-synthetic-cleanup-');
    cleanup.push(workspace);
    const leases = new FileResourceLeaseManager(workspace);
    const lease = await leases.acquire('profile:verify');
    await expect(leases.acquire('profile:verify')).rejects.toBeInstanceOf(
      ResourceLeaseConflictError,
    );
    await leases.release(lease);

    const artifacts = new FileArtifactStore(workspace);
    const orphan = await artifacts.put('orphan', {
      artifactType: 'log',
      mediaType: 'text/plain',
      redacted: true,
    });
    const old = new Date('2000-01-01T00:00:00.000Z');
    await utimes(artifacts.objectPath(orphan.sha256), old, old);
    const cleaned = await new FileEvidenceRetention(workspace).cleanup({
      roots: {
        activeAttemptIds: [],
        approvedBundleIds: [],
        recentSuccessBundleIds: [],
        failureBundleIds: [],
      },
      maxAgeMs: 0,
      maxBytes: 0,
      now: Date.parse('2026-10-18T00:00:00.000Z'),
    });
    expect(cleaned.removed).toEqual([orphan.sha256]);
    await expect(artifacts.exists(orphan)).resolves.toBe(false);
  });
});
