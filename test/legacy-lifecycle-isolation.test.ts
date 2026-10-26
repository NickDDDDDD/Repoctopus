import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FilePublicationJournalStore } from '../platform/delivery/file-publication-journal-store.js';
import { FileSpecificationPublicationJournalStore } from '../platform/delivery/file-specification-publication-journal-store.js';
import { FileRuntimeStore } from '../platform/runtime/file-runtime-store.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

describe('legacy lifecycle generation isolation', () => {
  it('does not scan or rewrite generation Run directories and Journal files', async () => {
    const workspace = await temporaryDirectory('repoctopus-legacy-isolation-');
    cleanup.push(workspace);
    const stableRunId = 'change-team-demo-0123456789abcdef';
    const legacyRunId = 'change-team-demo-g1-fedcba9876543210';
    const runsRoot = path.join(workspace, '.repoctopus', 'runs');
    for (const [runId, bundleId] of [
      [stableRunId, 'bundle-stable'],
      [legacyRunId, 'bundle-legacy'],
    ] as const) {
      const root = path.join(runsRoot, runId);
      await mkdir(root, { recursive: true });
      await writeFile(
        path.join(root, 'checkpoint.json'),
        `${JSON.stringify({
          schemaVersion: 1,
          runId,
          acceptedEvidenceBundleIds: [bundleId],
        })}\n`,
      );
    }
    const legacyPublication = path.join(
      workspace,
      '.repoctopus',
      'delivery',
      'publications',
      `${stableRunId}.g1.json`,
    );
    const legacySpecification = path.join(
      workspace,
      '.repoctopus',
      'delivery',
      'specification-publications',
      `${stableRunId}.g1.json`,
    );
    const legacyBytes = '{"schemaVersion":1,"generation":1}\n';
    await mkdir(path.dirname(legacyPublication), { recursive: true });
    await mkdir(path.dirname(legacySpecification), { recursive: true });
    await writeFile(legacyPublication, legacyBytes);
    await writeFile(legacySpecification, legacyBytes);

    await expect(new FileRuntimeStore(workspace).evidenceRetentionState()).resolves.toEqual({
      deferred: false,
      acceptedBundleIds: ['bundle-stable'],
    });
    await expect(new FilePublicationJournalStore(workspace).load(stableRunId)).resolves.toBeNull();
    await expect(
      new FileSpecificationPublicationJournalStore(workspace).load(stableRunId),
    ).resolves.toBeNull();
    expect(await readFile(legacyPublication, 'utf8')).toBe(legacyBytes);
    expect(await readFile(legacySpecification, 'utf8')).toBe(legacyBytes);
  });
});
