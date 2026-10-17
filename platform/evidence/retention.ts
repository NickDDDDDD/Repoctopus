import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import type { EvidenceBundle } from '../../domains/evidence/types.js';
import { FileResourceLeaseManager } from '../runtime/resource-lease.js';
import { FileEvidenceStore } from './file-evidence-store.js';

export interface EvidenceRetentionRoots {
  activeAttemptIds: string[];
  approvedBundleIds: string[];
  recentSuccessBundleIds: string[];
  failureBundleIds: string[];
}

export interface EvidenceCleanupOptions {
  roots: EvidenceRetentionRoots;
  maxAgeMs: number;
  maxBytes: number;
  now?: number;
}

export interface EvidenceCleanupResult {
  removed: string[];
  protected: string[];
  bytesBefore: number;
  bytesAfter: number;
}

async function existing<T>(operation: () => Promise<T>): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export class FileEvidenceRetention {
  private readonly store: FileEvidenceStore;
  private readonly leases: FileResourceLeaseManager;

  constructor(private readonly workspace: string) {
    this.store = new FileEvidenceStore(workspace);
    this.leases = new FileResourceLeaseManager(workspace);
  }

  private async markReceipt(receiptId: string, marked: Set<string>): Promise<void> {
    const receipt = await existing(() => this.store.loadReceipt(receiptId));
    if (!receipt) return;
    for (const artifact of receipt.artifacts) marked.add(artifact.sha256);
  }

  private async markBundle(bundleId: string, marked: Set<string>): Promise<void> {
    const bundle: EvidenceBundle | null = await existing(() => this.store.loadBundle(bundleId));
    if (!bundle) return;
    for (const digest of bundle.artifactDigests) marked.add(digest);
    await Promise.all(bundle.receiptIds.map((receiptId) => this.markReceipt(receiptId, marked)));
  }

  private async roots(options: EvidenceRetentionRoots): Promise<Set<string>> {
    const marked = new Set<string>();
    for (const attemptId of options.activeAttemptIds) {
      const attempt = await existing(() => this.store.loadAttempt(attemptId));
      if (attempt) {
        await Promise.all(
          attempt.receiptIds.map((receiptId) => this.markReceipt(receiptId, marked)),
        );
      }
    }
    const bundles = [
      ...options.approvedBundleIds,
      ...options.recentSuccessBundleIds,
      ...options.failureBundleIds,
    ];
    await Promise.all([...new Set(bundles)].map((bundleId) => this.markBundle(bundleId, marked)));
    return marked;
  }

  private async objects(): Promise<
    Array<{ digest: string; file: string; size: number; mtime: number }>
  > {
    const root = path.join(this.workspace, '.repoctopus', 'evidence', 'objects', 'sha256');
    const prefixes = await existing(() => readdir(root, { withFileTypes: true }));
    if (!prefixes) return [];
    const objects: Array<{ digest: string; file: string; size: number; mtime: number }> = [];
    for (const prefix of prefixes) {
      if (!prefix.isDirectory() || prefix.isSymbolicLink()) continue;
      const directory = path.join(root, prefix.name);
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (!entry.isFile() || entry.isSymbolicLink() || !/^[0-9a-f]{64}$/u.test(entry.name)) {
          continue;
        }
        const file = path.join(directory, entry.name);
        const information = await stat(file);
        objects.push({
          digest: entry.name,
          file,
          size: information.size,
          mtime: information.mtimeMs,
        });
      }
    }
    return objects;
  }

  async cleanup(options: EvidenceCleanupOptions): Promise<EvidenceCleanupResult> {
    if (!Number.isSafeInteger(options.maxAgeMs) || options.maxAgeMs < 0) {
      throw new Error('maxAgeMs must be a non-negative integer');
    }
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0) {
      throw new Error('maxBytes must be a non-negative integer');
    }
    return this.leases.withLease('evidence-store:mutation', async () => {
      const [marked, objects] = await Promise.all([this.roots(options.roots), this.objects()]);
      const now = options.now ?? Date.now();
      let bytes = objects.reduce((sum, item) => sum + item.size, 0);
      const bytesBefore = bytes;
      const removed: string[] = [];
      const candidates = objects
        .filter((item) => !marked.has(item.digest))
        .sort((left, right) => left.mtime - right.mtime || left.digest.localeCompare(right.digest));
      for (const candidate of candidates) {
        if (now - candidate.mtime <= options.maxAgeMs && bytes <= options.maxBytes) continue;
        await rm(candidate.file, { force: true });
        removed.push(candidate.digest);
        bytes -= candidate.size;
      }
      return {
        removed,
        protected: objects
          .filter((item) => marked.has(item.digest))
          .map((item) => item.digest)
          .sort(),
        bytesBefore,
        bytesAfter: bytes,
      };
    });
  }
}
