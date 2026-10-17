import { afterEach, describe, expect, it, vi } from 'vitest';

import { canReuseReceipt } from '../domains/evidence/lifecycle.js';
import { EvidenceService } from '../domains/evidence/service.js';
import type { EvidenceReceipt } from '../domains/evidence/types.js';
import type { CommandAdapter } from '../domains/feedback/ports.js';
import { compileEvidenceProfile } from '../domains/feedback/profile.js';
import type { EffectiveProjectConfig } from '../domains/project-configuration/types.js';
import { FileArtifactStore } from '../platform/evidence/file-artifact-store.js';
import { FileEvidenceStore } from '../platform/evidence/file-evidence-store.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

function plan(workspace: string) {
  const config: EffectiveProjectConfig = {
    shared: {
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'RepoctopusProject',
      project: { id: 'sample' },
      repositories: [{ id: 'repo', path: '.' }],
      profiles: [
        {
          id: 'verify',
          nodes: [
            {
              id: 'build',
              type: 'command',
              repository: 'repo',
              dependsOn: [],
              required: true,
              executable: 'ignored',
              args: [],
              timeoutMs: 1000,
              cache: true,
              cacheTtlMs: 60_000,
            },
          ],
        },
      ],
    },
    local: null,
    repositories: [{ id: 'repo', path: '.', resolvedPath: workspace }],
    sharedDigest: 'shared',
    localDigest: null,
    effectiveDigest: 'effective',
  };
  return compileEvidenceProfile(config, 'verify');
}

describe('evidence lifecycle', () => {
  it('reuses only exact, current, verified deterministic command receipts', async () => {
    const workspace = await temporaryDirectory('repoctopus-reuse-');
    cleanup.push(workspace);
    const run = vi.fn<CommandAdapter['run']>().mockResolvedValue({
      exitCode: 0,
      stdout: 'built',
      stderr: '',
      timedOut: false,
    });
    const service = new EvidenceService(
      new FileArtifactStore(workspace),
      new FileEvidenceStore(workspace),
      { run },
    );
    const first = await service.run(plan(workspace), 'same-fingerprint');
    const second = await service.run(plan(workspace), 'same-fingerprint', {
      reusableReceipts: first.receipts,
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(second.receipts[0]?.freshness).toBe('reused');
    expect(second.receipts[0]?.sourceReceiptId).toBe(first.receipts[0]?.receiptId);

    const receipt = first.receipts[0]!;
    expect(
      canReuseReceipt(receipt, {
        nodeId: 'build',
        inputFingerprint: 'same-fingerprint',
        now: receipt.completedAt,
        adapterKind: 'service',
      }),
    ).toBe(false);
    expect(
      canReuseReceipt(receipt, {
        nodeId: 'build',
        inputFingerprint: 'different',
        now: receipt.completedAt,
        adapterKind: 'command',
      }),
    ).toBe(false);
  });

  it('marks a run superseded when the ending fence changes', async () => {
    const workspace = await temporaryDirectory('repoctopus-fence-');
    cleanup.push(workspace);
    const adapter: CommandAdapter = {
      run: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '', timedOut: false }),
    };
    const result = await new EvidenceService(
      new FileArtifactStore(workspace),
      new FileEvidenceStore(workspace),
      adapter,
    ).run(plan(workspace), 'start-fingerprint', {
      captureEndingFingerprint: () => Promise.resolve('changed-fingerprint'),
    });
    expect(result.attempt.status).toBe('superseded');
    expect(result.bundle.outcome).toBe('incomplete');
    expect(result.bundle.checks[0]?.freshness).toBe('superseded');
  });

  it('does not reuse expired command receipts', () => {
    const receipt: EvidenceReceipt = {
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'EvidenceReceipt',
      receiptId: 'receipt',
      attemptId: 'attempt',
      nodeId: 'build',
      adapter: 'command/local',
      trust: 'verified',
      freshness: 'fresh',
      status: 'passed',
      inputFingerprint: 'fingerprint',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:01.000Z',
      validUntil: '2026-01-01T00:01:00.000Z',
      artifacts: [],
      findings: [],
    };
    expect(
      canReuseReceipt(receipt, {
        nodeId: 'build',
        inputFingerprint: 'fingerprint',
        now: '2026-01-01T00:01:00.001Z',
        adapterKind: 'command',
      }),
    ).toBe(false);
  });
});
