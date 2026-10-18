import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  VisualInspectionAdapter,
  VisualInspectionRequest,
  VisualInspectionResponse,
} from '../../domains/feedback/visual.js';
import { atomicWriteJson } from '../filesystem/atomic-write.js';

export interface FileExchangeVisualOptions {
  exchangeDirectory: string;
  responseTimeoutMs?: number;
  pollIntervalMs?: number;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class FileExchangeVisualInspectionAdapter implements VisualInspectionAdapter {
  private readonly exchangeDirectory: string;
  private readonly responseTimeoutMs: number;
  private readonly pollIntervalMs: number;

  constructor(workspace: string, options: FileExchangeVisualOptions) {
    this.exchangeDirectory = path.resolve(workspace, options.exchangeDirectory);
    this.responseTimeoutMs = options.responseTimeoutMs ?? 10 * 60 * 1000;
    this.pollIntervalMs = options.pollIntervalMs ?? 250;
  }

  async inspect(request: VisualInspectionRequest): Promise<VisualInspectionResponse | null> {
    const requests = path.join(this.exchangeDirectory, 'requests');
    const responses = path.join(this.exchangeDirectory, 'responses');
    await Promise.all([mkdir(requests, { recursive: true }), mkdir(responses, { recursive: true })]);
    await atomicWriteJson(path.join(requests, `${request.requestId}.json`), request);

    const responseFile = path.join(responses, `${request.requestId}.json`);
    const deadline = Date.now() + this.responseTimeoutMs;
    while (Date.now() < deadline) {
      try {
        return JSON.parse(await readFile(responseFile, 'utf8')) as VisualInspectionResponse;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await wait(this.pollIntervalMs);
    }
    return null;
  }
}
