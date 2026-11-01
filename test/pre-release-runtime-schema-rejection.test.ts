import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FileRuntimeStore } from '../platform/runtime/file-runtime-store.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

describe('pre-release Runtime checkpoint rejection', () => {
  it('fails closed without rewriting an incomplete checkpoint', async () => {
    const workspace = await temporaryDirectory('repoctopus-checkpoint-rejection-');
    cleanup.push(workspace);
    const runId = 'change-team-demo-0123456789abcdef';
    const checkpointFile = path.join(
      workspace,
      '.repoctopus',
      'runs',
      runId,
      'checkpoint.json',
    );
    const originalBytes = `${JSON.stringify({
      schemaVersion: 1,
      runId,
      acceptedEvidenceBundleIds: ['pre-release-bundle'],
    })}\n`;
    await mkdir(path.dirname(checkpointFile), { recursive: true });
    await writeFile(checkpointFile, originalBytes);

    await expect(new FileRuntimeStore(workspace).evidenceRetentionState()).rejects.toThrow(
      /Invalid current Runtime checkpoint schema/u,
    );
    expect(await readFile(checkpointFile, 'utf8')).toBe(originalBytes);
  });

  it('retains evidence roots only from complete current checkpoints', async () => {
    const workspace = await temporaryDirectory('repoctopus-checkpoint-retention-');
    cleanup.push(workspace);
    const runId = 'change-team-demo-fedcba9876543210';
    const checkpointFile = path.join(
      workspace,
      '.repoctopus',
      'runs',
      runId,
      'checkpoint.json',
    );
    await mkdir(path.dirname(checkpointFile), { recursive: true });
    await writeFile(
      checkpointFile,
      `${JSON.stringify({
        schemaVersion: 1,
        runId,
        stateVersion: 8,
        workflowDigest: 'workflow-current',
        compositionDigest: 'composition-current',
        trajectoryOffset: 12,
        projectSnapshotDigest: 'project-current',
        artifactManifestDigest: 'artifacts-current',
        acceptedEvidenceBundleIds: ['bundle-current'],
        createdAt: '2026-11-01T00:00:00.000Z',
      })}\n`,
    );

    await expect(new FileRuntimeStore(workspace).evidenceRetentionState()).resolves.toEqual({
      deferred: false,
      acceptedBundleIds: ['bundle-current'],
    });
  });
});
