import { afterEach, describe, expect, it, vi } from 'vitest';

import { recoverEvidenceAttempt } from '../domains/evidence/recovery.js';
import { EvidenceService } from '../domains/evidence/service.js';
import type { CommandAdapter } from '../domains/feedback/ports.js';
import { compileEvidenceProfile } from '../domains/feedback/profile.js';
import type { EffectiveProjectConfig } from '../domains/project-configuration/types.js';
import { FileArtifactStore } from '../platform/evidence/file-artifact-store.js';
import { FileEvidenceJournal } from '../platform/evidence/file-evidence-journal.js';
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
              cache: false,
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

describe('evidence recovery', () => {
  it('serializes concurrent journal appends within one Runtime process', async () => {
    const workspace = await temporaryDirectory('repoctopus-evidence-journal-parallel-');
    cleanup.push(workspace);
    const journal = new FileEvidenceJournal(workspace);
    await Promise.all([
      journal.recordIntent('attempt-parallel', 'frontend', '2026-01-01T00:00:00.000Z'),
      journal.recordIntent('attempt-parallel', 'backend', '2026-01-01T00:00:00.001Z'),
    ]);
    const entries = await journal.load('attempt-parallel');
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.sequence)).toEqual([1, 2]);
    expect(entries.map((entry) => entry.nodeId).sort()).toEqual(['backend', 'frontend']);
  });

  it('reuses the committed receipt after a crash without repeating the command', async () => {
    const workspace = await temporaryDirectory('repoctopus-evidence-recovery-');
    cleanup.push(workspace);
    const run = vi.fn<CommandAdapter['run']>().mockResolvedValue({
      exitCode: 0,
      stdout: 'built',
      stderr: '',
      timedOut: false,
      stdoutBytes: 5,
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
    });
    const store = new FileEvidenceStore(workspace);
    const journal = new FileEvidenceJournal(workspace);
    const service = new EvidenceService(
      new FileArtifactStore(workspace),
      store,
      { run },
      undefined,
      journal,
    );
    let attemptId = '';
    await expect(
      service.run(plan(workspace), 'fingerprint', {
        afterNodeCommitted: (receipt) => {
          attemptId = receipt.attemptId;
          throw new Error('simulated crash');
        },
      }),
    ).rejects.toThrow('simulated crash');
    expect(run).toHaveBeenCalledTimes(1);

    const recovered = await recoverEvidenceAttempt({
      attemptId,
      plan: plan(workspace),
      store,
      journal,
      timestamp: '2026-01-01T00:00:02.000Z',
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(recovered.bundle.outcome).toBe('passed');
    expect(recovered.receipts[0]?.receiptId).toBe(
      (await journal.load(attemptId)).find((entry) => entry.type === 'node.completed')?.receiptId,
    );
  });
});
