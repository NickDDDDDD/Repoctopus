import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
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

function sameIntentIdentity(left: ActionIntent, right: ActionIntent): boolean {
  const leftStable = { ...left, createdAt: '' };
  const rightStable = { ...right, createdAt: '' };
  return canonicalJson(leftStable) === canonicalJson(rightStable);
}

export class FileActionStore implements ActionStorePort {
  constructor(private readonly workspaceRoot: string) {}

  private runRoot(runId: string): string {
    assertRunId(runId);
    return path.join(path.resolve(this.workspaceRoot), '.repoctopus', 'actions', runId);
  }

  private intentDirectory(runId: string, workId: string): string {
    return path.join(this.runRoot(runId), 'intents', safeName(workId));
  }

  private intentFile(runId: string, workId: string, attempt: number): string {
    return path.join(this.intentDirectory(runId, workId), `${attempt}.json`);
  }

  private receiptFile(runId: string, receiptId: string): string {
    return path.join(this.runRoot(runId), 'receipts', `${safeName(receiptId)}.json`);
  }

  async saveIntent(intent: ActionIntent): Promise<ActionIntent> {
    if (!Number.isSafeInteger(intent.attempt) || intent.attempt < 1) {
      throw new Error('Action claim attempt must be a positive safe integer');
    }
    const file = this.intentFile(intent.runId, intent.workId, intent.attempt);
    if (await exists(file)) {
      const current = await readJson<ActionIntent>(file);
      if (!sameIntentIdentity(current, intent)) {
        throw new Error(`Action intent identity changed: ${intent.action.id}`);
      }
      return current;
    }
    try {
      await atomicWriteJson(file, intent, { exclusive: true });
      return intent;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const winner = await readJson<ActionIntent>(file);
      if (!sameIntentIdentity(winner, intent)) {
        throw new Error(`Action claim was won by another identity: ${intent.workId}`, {
          cause: error,
        });
      }
      return winner;
    }
  }

  async loadIntent(runId: string, workId: string, attempt = 1): Promise<ActionIntent> {
    return readJson<ActionIntent>(this.intentFile(runId, workId, attempt));
  }

  async loadLatestIntent(runId: string, workId: string): Promise<ActionIntent> {
    const latest = await this.optionalLatestIntent(runId, workId);
    if (!latest) throw new Error(`Action Work has no claim: ${workId}`);
    return latest;
  }

  private async optionalLatestIntent(runId: string, workId: string): Promise<ActionIntent | null> {
    const directory = this.intentDirectory(runId, workId);
    let entries: string[];
    try {
      entries = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    const attempts = entries
      .map((entry) => /^(\d+)\.json$/u.exec(entry)?.[1] ?? '')
      .filter(Boolean)
      .map(Number)
      .filter((attempt) => Number.isSafeInteger(attempt) && attempt > 0)
      .sort((left, right) => right - left);
    return attempts[0] ? readJson<ActionIntent>(this.intentFile(runId, workId, attempts[0])) : null;
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
