import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  ChangeLifecycleMigrationIntent,
  ChangeLifecycleMigrationJournal,
  ChangeLifecycleMigrationReceipt,
  ChangeLifecycleMigrationStore,
} from '../../domains/change-lifecycle/migration-transaction.js';
import { canonicalJson } from '../../domains/workflow-contract/canonical.js';
import { atomicWriteJson } from '../filesystem/atomic-write.js';

export interface FileChangeLifecycleMigrationStoreHooks {
  beforeReceiptWrite?(receipt: ChangeLifecycleMigrationReceipt): Promise<void> | void;
}

export class FileChangeLifecycleMigrationStore implements ChangeLifecycleMigrationStore {
  constructor(
    private readonly workspaceRoot: string,
    private readonly hooks: FileChangeLifecycleMigrationStoreHooks = {},
  ) {}

  private file(transactionId: string): string {
    if (!/^sha256:[a-f0-9]{64}$/u.test(transactionId)) {
      throw new Error('Migration transaction id is invalid');
    }
    return path.join(
      this.workspaceRoot,
      '.repoctopus',
      'change-lifecycle-migrations',
      `${transactionId.slice('sha256:'.length)}.json`,
    );
  }

  async load(transactionId: string): Promise<ChangeLifecycleMigrationJournal | null> {
    try {
      return JSON.parse(await readFile(this.file(transactionId), 'utf8')) as ChangeLifecycleMigrationJournal;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async saveIntent(intent: ChangeLifecycleMigrationIntent): Promise<void> {
    const existing = await this.load(intent.transactionId);
    if (existing && canonicalJson(existing.intent) !== canonicalJson(intent)) {
      throw new Error('Migration Intent conflicts with the existing Journal');
    }
    if (existing) return;
    await atomicWriteJson(this.file(intent.transactionId), { intent }, { containedRoot: this.workspaceRoot });
  }

  async saveReceipt(receipt: ChangeLifecycleMigrationReceipt): Promise<void> {
    const existing = await this.load(receipt.transactionId);
    if (!existing || canonicalJson(existing.intent) !== canonicalJson({
      schemaVersion: receipt.schemaVersion,
      transactionId: receipt.transactionId,
      planDigest: receipt.planDigest,
      legacyIdentity: receipt.legacyIdentity,
      targetRunId: receipt.targetRunId,
      targetGeneration: receipt.targetGeneration,
      auditReferences: receipt.auditReferences,
    })) {
      throw new Error('Migration Receipt has no matching persisted Intent');
    }
    if (existing.receipt) {
      if (canonicalJson(existing.receipt) !== canonicalJson(receipt)) {
        throw new Error('Migration Receipt conflicts with the existing Journal');
      }
      return;
    }
    await this.hooks.beforeReceiptWrite?.(receipt);
    await atomicWriteJson(
      this.file(receipt.transactionId),
      { intent: existing.intent, receipt },
      { containedRoot: this.workspaceRoot },
    );
  }
}
