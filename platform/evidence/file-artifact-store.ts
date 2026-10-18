import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';

import type { ArtifactStore, PutArtifactOptions } from '../../domains/evidence/ports.js';
import { EVIDENCE_API_VERSION, type ArtifactRef } from '../../domains/evidence/types.js';
import { readFileRaceSafe } from '../filesystem/race-safe-read.js';
import { linkWithRetry, unlinkWithRetry } from '../filesystem/transient-retry.js';

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
      const existing = (
        await readFileRaceSafe(target, Math.max(1, bytes.byteLength), {
          label: 'artifact object',
        })
      ).bytes;
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
        await linkWithRetry(temporary, target);
      } catch (publishError) {
        if ((publishError as NodeJS.ErrnoException).code !== 'EEXIST') throw publishError;
        const winner = (
          await readFileRaceSafe(target, Math.max(1, bytes.byteLength), {
            label: 'artifact object',
          })
        ).bytes;
        if (!winner.equals(bytes)) {
          throw new Error(`Artifact digest collision: ${sha256}`, { cause: publishError });
        }
      } finally {
        await unlinkWithRetry(temporary).catch((cleanupError: NodeJS.ErrnoException) => {
          if (cleanupError.code !== 'ENOENT') throw cleanupError;
        });
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
    const contents = (
      await readFileRaceSafe(this.objectPath(reference.sha256), Math.max(1, reference.size), {
        label: 'artifact object',
      })
    ).bytes;
    const digest = createHash('sha256').update(contents).digest('hex');
    if (digest !== reference.sha256 || contents.byteLength !== reference.size) {
      throw new Error(`Artifact integrity check failed: ${reference.sha256}`);
    }
    return contents;
  }

  async exists(reference: ArtifactRef): Promise<boolean> {
    try {
      await this.read(reference);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
}
