import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import type { ArtifactStore, PutArtifactOptions } from '../../domains/evidence/ports.js';
import { EVIDENCE_API_VERSION, type ArtifactRef } from '../../domains/evidence/types.js';

export class FileArtifactStore implements ArtifactStore {
  constructor(private readonly workspace: string) {}

  objectPath(digest: string): string {
    return path.join(
      this.workspace,
      '.repoctopus',
      'evidence',
      'objects',
      'sha256',
      digest.slice(0, 2),
      digest,
    );
  }

  async put(contents: Uint8Array | string, options: PutArtifactOptions): Promise<ArtifactRef> {
    const bytes =
      typeof contents === 'string' ? Buffer.from(contents, 'utf8') : Buffer.from(contents);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const target = this.objectPath(sha256);
    await mkdir(path.dirname(target), { recursive: true });
    try {
      const existing = await readFile(target);
      if (!existing.equals(bytes)) throw new Error(`Artifact digest collision: ${sha256}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const temporary = `${target}.${randomUUID()}.tmp`;
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await rename(temporary, target);
      } catch (renameError) {
        await rm(temporary, { force: true });
        try {
          const winner = await readFile(target);
          if (!winner.equals(bytes)) {
            throw new Error(`Artifact digest collision: ${sha256}`, { cause: renameError });
          }
        } catch (readError) {
          if ((readError as NodeJS.ErrnoException).code === 'ENOENT') throw renameError;
          throw readError;
        }
      }
    }
    return {
      apiVersion: EVIDENCE_API_VERSION,
      kind: 'ArtifactRef',
      sha256,
      size: bytes.byteLength,
      mediaType: options.mediaType,
      artifactType: options.artifactType,
      redacted: options.redacted,
    };
  }

  async read(reference: ArtifactRef): Promise<Buffer> {
    const contents = await readFile(this.objectPath(reference.sha256));
    const digest = createHash('sha256').update(contents).digest('hex');
    if (digest !== reference.sha256 || contents.byteLength !== reference.size) {
      throw new Error(`Artifact integrity check failed: ${reference.sha256}`);
    }
    return contents;
  }

  async exists(reference: ArtifactRef): Promise<boolean> {
    try {
      const info = await stat(this.objectPath(reference.sha256));
      return info.isFile() && info.size === reference.size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
}
