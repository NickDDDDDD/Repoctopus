import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  ConsistencyReviewReceipt,
  ConsistencyReviewRequest,
} from '../../domains/consistency/review.js';
import type { PublicationReceipt } from '../../domains/delivery/publication-receipt.js';
import { atomicWriteJson } from '../filesystem/atomic-write.js';

export class FileConsistencyStore {
  constructor(private readonly workspaceRoot: string) {}

  private publicationRoot(): string {
    return path.join(this.workspaceRoot, '.repoctopus', 'delivery', 'publication-receipts');
  }

  async publications(): Promise<PublicationReceipt[]> {
    const entries = await readdir(this.publicationRoot(), { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      },
    );
    return Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(async (entry) => {
          const parsed: unknown = JSON.parse(
            await readFile(path.join(this.publicationRoot(), entry.name), 'utf8'),
          );
          return parsed as PublicationReceipt;
        }),
    );
  }

  async savePublication(receipt: PublicationReceipt): Promise<void> {
    await atomicWriteJson(path.join(this.publicationRoot(), `${receipt.runId}.json`), receipt, {
      containedRoot: this.workspaceRoot,
    });
  }

  async saveRequest(request: ConsistencyReviewRequest): Promise<void> {
    await atomicWriteJson(
      path.join(
        this.workspaceRoot,
        '.repoctopus',
        'consistency',
        'requests',
        `${request.requestId.slice('sha256:'.length)}.json`,
      ),
      request,
      { containedRoot: this.workspaceRoot },
    );
  }

  async saveReceipt(receipt: ConsistencyReviewReceipt): Promise<void> {
    await atomicWriteJson(
      path.join(
        this.workspaceRoot,
        '.repoctopus',
        'consistency',
        'receipts',
        `${receipt.requestId.slice('sha256:'.length)}.json`,
      ),
      receipt,
      { containedRoot: this.workspaceRoot },
    );
  }
}
