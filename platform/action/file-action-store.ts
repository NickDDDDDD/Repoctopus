import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import type { ActionStorePort } from '../../domains/action/ports.js';
import type { ActionIntent, ActionReceipt } from '../../domains/action/types.js';
import { canonicalJson } from '../../domains/workflow-contract/canonical.js';
import { atomicWriteJson } from '../filesystem/atomic-write.js';
import { assertRunId } from '../runtime/paths.js';

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

function safeName(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export class FileActionStore implements ActionStorePort {
  constructor(private readonly workspaceRoot: string) {}

  private runRoot(runId: string): string {
    assertRunId(runId);
    return path.join(path.resolve(this.workspaceRoot), '.repoctopus', 'actions', runId);
  }

  private intentFile(runId: string, actionId: string): string {
    return path.join(this.runRoot(runId), 'intents', `${safeName(actionId)}.json`);
  }

  private receiptFile(runId: string, receiptId: string): string {
    return path.join(this.runRoot(runId), 'receipts', `${safeName(receiptId)}.json`);
  }

  async saveIntent(intent: ActionIntent): Promise<ActionIntent> {
    const file = this.intentFile(intent.runId, intent.action.id);
    if (await exists(file)) {
      const current = await readJson<ActionIntent>(file);
      if (
        current.intentId !== intent.intentId ||
        current.idempotencyKey !== intent.idempotencyKey ||
        current.runId !== intent.runId ||
        current.adapter !== intent.adapter ||
        canonicalJson(current.action) !== canonicalJson(intent.action)
      ) {
        throw new Error(`Action intent identity changed: ${intent.action.id}`);
      }
      return current;
    }
    await atomicWriteJson(file, intent);
    return intent;
  }

  async loadIntent(runId: string, actionId: string): Promise<ActionIntent> {
    return readJson<ActionIntent>(this.intentFile(runId, actionId));
  }

  async saveReceipt(receipt: ActionReceipt): Promise<ActionReceipt> {
    const file = this.receiptFile(receipt.runId, receipt.receiptId);
    if (await exists(file)) {
      const current = await readJson<ActionReceipt>(file);
      const currentStable = { ...current, completedAt: '' };
      const nextStable = { ...receipt, completedAt: '' };
      if (canonicalJson(currentStable) !== canonicalJson(nextStable)) {
        throw new Error(`Action receipt identity changed: ${receipt.receiptId}`);
      }
      return current;
    }
    await atomicWriteJson(file, receipt);
    return receipt;
  }

  async loadReceipt(runId: string, receiptId: string): Promise<ActionReceipt> {
    return readJson<ActionReceipt>(this.receiptFile(runId, receiptId));
  }
}
