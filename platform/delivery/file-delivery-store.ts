import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import type { DeliveryEvent, DeliveryStorePort } from '../../domains/delivery/ports.js';
import type { DeliveryState } from '../../domains/delivery/types.js';
import { atomicWriteJson, atomicWriteText } from '../filesystem/atomic-write.js';

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

interface DeliveryJournal {
  schemaVersion: 1;
  previousStateVersion: number | null;
  nextState: DeliveryState;
  event: DeliveryEvent;
}
export interface DeliveryStoreHooks {
  afterJournalWritten?(journal: DeliveryJournal): void | Promise<void>;
  afterHistoryWritten?(journal: DeliveryJournal): void | Promise<void>;
  afterStateWritten?(journal: DeliveryJournal): void | Promise<void>;
}

function assertChangeId(changeId: string): void {
  if (!/^[a-z0-9][a-z0-9-]{2,127}$/.test(changeId))
    throw new Error(`Invalid change id: ${changeId}`);
}

export class FileDeliveryStore implements DeliveryStorePort {
  constructor(
    private readonly workspaceRoot: string,
    private readonly hooks: DeliveryStoreHooks = {},
  ) {}
  private paths(changeId: string) {
    assertChangeId(changeId);
    const root = path.join(path.resolve(this.workspaceRoot), '.repoctopus', 'deliveries', changeId);
    return {
      root,
      state: path.join(root, 'state.json'),
      history: path.join(root, 'history.jsonl'),
      journal: path.join(root, 'transition.json'),
      lock: path.join(root, 'transition.lock'),
    };
  }

  async load(changeId: string): Promise<DeliveryState | null> {
    await this.recover(changeId);
    const file = this.paths(changeId).state;
    return (await exists(file)) ? readJson<DeliveryState>(file) : null;
  }
  async history(changeId: string): Promise<DeliveryEvent[]> {
    await this.recover(changeId);
    const file = this.paths(changeId).history;
    if (!(await exists(file))) return [];
    const source = await readFile(file, 'utf8');
    if (!source) return [];
    if (!source.endsWith('\n')) throw new Error('Delivery history is truncated');
    return source
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line) as DeliveryEvent);
  }

  async commit(options: {
    state: DeliveryState;
    previousStateVersion: number | null;
    event: DeliveryEvent;
  }): Promise<void> {
    const paths = this.paths(options.state.changeId);
    await this.withLock(paths, async () => {
      await this.recoverUnlocked(paths);
      const current = (await exists(paths.state))
        ? await readJson<DeliveryState>(paths.state)
        : null;
      if (options.previousStateVersion === null) {
        if (current) throw new Error(`Delivery already exists: ${options.state.changeId}`);
      } else if (!current || current.stateVersion !== options.previousStateVersion)
        throw new Error(`Stale delivery state: ${options.state.changeId}`);
      if (
        options.event.changeId !== options.state.changeId ||
        options.event.stateVersion !== options.state.stateVersion
      )
        throw new Error('Delivery event does not match state');
      const journal: DeliveryJournal = {
        schemaVersion: 1,
        previousStateVersion: options.previousStateVersion,
        nextState: options.state,
        event: options.event,
      };
      await atomicWriteJson(paths.journal, journal);
      await this.hooks.afterJournalWritten?.(journal);
      await this.complete(paths, journal);
    });
  }

  private async complete(
    paths: ReturnType<FileDeliveryStore['paths']>,
    journal: DeliveryJournal,
  ): Promise<void> {
    const history = (await exists(paths.history)) ? await this.historyUnlocked(paths.history) : [];
    if (!history.some((item) => item.eventId === journal.event.eventId)) {
      await atomicWriteText(
        paths.history,
        [...history, journal.event].map((item) => JSON.stringify(item)).join('\n') + '\n',
      );
      await this.hooks.afterHistoryWritten?.(journal);
    }
    await atomicWriteJson(paths.state, journal.nextState);
    await this.hooks.afterStateWritten?.(journal);
    await rm(paths.journal, { force: true });
  }
  private async historyUnlocked(file: string): Promise<DeliveryEvent[]> {
    const source = await readFile(file, 'utf8');
    if (!source.endsWith('\n')) throw new Error('Delivery history is truncated');
    return source
      .trimEnd()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as DeliveryEvent);
  }
  private async recover(changeId: string): Promise<void> {
    const paths = this.paths(changeId);
    if (!(await exists(paths.journal))) return;
    await this.withLock(paths, () => this.recoverUnlocked(paths));
  }
  private async recoverUnlocked(paths: ReturnType<FileDeliveryStore['paths']>): Promise<void> {
    if (!(await exists(paths.journal))) return;
    const journal = await readJson<DeliveryJournal>(paths.journal);
    if (journal.schemaVersion !== 1) throw new Error('Invalid delivery journal');
    await this.complete(paths, journal);
  }

  private async withLock<T>(
    paths: ReturnType<FileDeliveryStore['paths']>,
    operation: () => Promise<T>,
  ): Promise<T> {
    await mkdir(paths.root, { recursive: true });
    let handle;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        handle = await open(paths.lock, 'wx', 0o600);
        await handle.writeFile(
          `${JSON.stringify({ schemaVersion: 1, pid: process.pid, createdAt: new Date().toISOString() })}\n`,
          'utf8',
        );
        await handle.sync();
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try {
          const owner = await readJson<{ pid?: number; createdAt?: string }>(paths.lock);
          const age = owner.createdAt
            ? Date.now() - Date.parse(owner.createdAt)
            : Number.POSITIVE_INFINITY;
          let alive = false;
          if (typeof owner.pid === 'number') {
            try {
              process.kill(owner.pid, 0);
              alive = true;
            } catch (processError) {
              alive = (processError as NodeJS.ErrnoException).code === 'EPERM';
            }
          }
          if (!alive || !Number.isFinite(age) || age > 5 * 60_000) {
            await rm(paths.lock, { force: true });
            continue;
          }
        } catch (readError) {
          if ((readError as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw readError;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    if (!handle) throw new Error(`Delivery transition is busy: ${paths.root}`);
    try {
      return await operation();
    } finally {
      await handle.close();
      await rm(paths.lock, { force: true });
    }
  }
}
