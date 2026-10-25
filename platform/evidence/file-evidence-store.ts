import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import type { EvidenceStore } from '../../domains/evidence/ports.js';
import type {
  EvidenceAttempt,
  EvidenceBundle,
  EvidenceReceipt,
} from '../../domains/evidence/types.js';
import {
  parseEvidenceAttempt,
  parseEvidenceBundle,
  parseEvidenceReceipt,
} from '../../domains/evidence/validation.js';
import { atomicWriteJson } from '../filesystem/atomic-write.js';

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8')) as unknown;
}

export class FileEvidenceStore implements EvidenceStore {
  constructor(private readonly workspace: string) {}

  private root(...segments: string[]): string {
    return path.join(this.workspace, '.repoctopus', 'evidence', ...segments);
  }

  async saveAttempt(attempt: EvidenceAttempt): Promise<void> {
    parseEvidenceAttempt(attempt);
    await atomicWriteJson(this.root('attempts', `${attempt.attemptId}.json`), attempt);
  }

  async loadAttempt(attemptId: string): Promise<EvidenceAttempt> {
    return parseEvidenceAttempt(await readJson(this.root('attempts', `${attemptId}.json`)));
  }

  async saveReceipt(receipt: EvidenceReceipt): Promise<void> {
    parseEvidenceReceipt(receipt);
    await atomicWriteJson(this.root('receipts', `${receipt.receiptId}.json`), receipt);
  }

  async loadReceipt(receiptId: string): Promise<EvidenceReceipt> {
    return parseEvidenceReceipt(await readJson(this.root('receipts', `${receiptId}.json`)));
  }

  async saveBundle(bundle: EvidenceBundle): Promise<void> {
    parseEvidenceBundle(bundle);
    await atomicWriteJson(this.root('bundles', `${bundle.bundleId}.json`), bundle);
  }

  async loadBundle(bundleId: string): Promise<EvidenceBundle> {
    return parseEvidenceBundle(await readJson(this.root('bundles', `${bundleId}.json`)));
  }

  async findBundleByAttempt(attemptId: string): Promise<EvidenceBundle | null> {
    const directory = this.root('bundles');
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    const matches: EvidenceBundle[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) continue;
      const bundle = parseEvidenceBundle(await readJson(path.join(directory, entry.name)));
      if (bundle.attemptId === attemptId) matches.push(bundle);
    }
    if (matches.length > 1) {
      throw new Error(`Evidence attempt has multiple bundles: ${attemptId}`);
    }
    return matches[0] ?? null;
  }
}
