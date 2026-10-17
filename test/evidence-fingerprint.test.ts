import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createEvidenceFingerprint } from '../domains/evidence/fingerprint.js';
import { collectRepositoryFingerprint } from '../platform/git/evidence-fingerprint.js';
import {
  createGitRepository,
  removeTemporaryDirectory,
  temporaryDirectory,
} from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

describe('evidence fingerprint', () => {
  it('binds actual dirty and untracked file contents', async () => {
    const root = await temporaryDirectory('repoctopus-fingerprint-');
    cleanup.push(root);
    const repository = await createGitRepository(root, 'service');
    await writeFile(path.join(repository, 'README.md'), '# changed\n');
    await writeFile(path.join(repository, 'new.txt'), 'one');
    const first = await collectRepositoryFingerprint({ repositoryId: 'service', root: repository });
    await writeFile(path.join(repository, 'new.txt'), 'two');
    const second = await collectRepositoryFingerprint({
      repositoryId: 'service',
      root: repository,
    });
    expect(first.head).toBe(second.head);
    expect(first.tree).toBe(second.tree);
    expect(first.dirtyFiles.map((item) => item.path)).toEqual(['README.md', 'new.txt']);
    expect(first.dirtyFiles.find((item) => item.path === 'new.txt')?.sha256).not.toBe(
      second.dirtyFiles.find((item) => item.path === 'new.txt')?.sha256,
    );
  });

  it('changes for every declared non-repository input without storing roots', async () => {
    const root = await temporaryDirectory('repoctopus-fingerprint-inputs-');
    cleanup.push(root);
    const repository = await createGitRepository(root, 'service');
    const repositoryFact = await collectRepositoryFingerprint({
      repositoryId: 'service',
      root: repository,
    });
    const base = {
      schemaVersion: 1 as const,
      profileId: 'verify',
      sharedConfigDigest: 'shared',
      localConfigDigest: 'local',
      repositories: [repositoryFact],
      tools: { node: '24.0.0' },
      adapters: { command: '1' },
      browser: { name: 'chromium', version: '1', revision: '100' },
      journeyDigest: 'journey',
      inputArtifactDigests: ['artifact'],
    };
    const original = createEvidenceFingerprint(base);
    for (const changed of [
      { ...base, sharedConfigDigest: 'changed' },
      { ...base, localConfigDigest: 'changed' },
      { ...base, tools: { node: '25.0.0' } },
      { ...base, adapters: { command: '2' } },
      { ...base, browser: { ...base.browser, revision: '101' } },
      { ...base, journeyDigest: 'changed' },
      { ...base, inputArtifactDigests: ['changed'] },
    ]) {
      expect(createEvidenceFingerprint(changed).digest).not.toBe(original.digest);
    }
    expect(JSON.stringify(original.manifest)).not.toContain(repository);
  });
});
