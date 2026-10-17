import { writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';

import { FileArtifactStore } from '../platform/evidence/file-artifact-store.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

describe('file artifact store', () => {
  it('deduplicates identical content and verifies reads', async () => {
    const workspace = await temporaryDirectory('repoctopus-artifact-');
    cleanup.push(workspace);
    const store = new FileArtifactStore(workspace);
    const first = await store.put('same content', {
      artifactType: 'test-log',
      mediaType: 'text/plain',
      redacted: true,
    });
    const second = await store.put('same content', {
      artifactType: 'test-log',
      mediaType: 'text/plain',
      redacted: true,
    });
    expect(second.sha256).toBe(first.sha256);
    expect((await store.read(first)).toString('utf8')).toBe('same content');
  });

  it('rejects a corrupted object', async () => {
    const workspace = await temporaryDirectory('repoctopus-artifact-corrupt-');
    cleanup.push(workspace);
    const store = new FileArtifactStore(workspace);
    const reference = await store.put('original', {
      artifactType: 'test-log',
      mediaType: 'text/plain',
      redacted: true,
    });
    await writeFile(store.objectPath(reference.sha256), 'tampered');
    await expect(store.read(reference)).rejects.toThrow(/integrity check failed/i);
  });
});
