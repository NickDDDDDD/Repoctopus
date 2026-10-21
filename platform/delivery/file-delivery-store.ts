import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import type { DeliveryEvent, DeliveryStorePort } from '../../domains/delivery/ports.js';
import type { DeliveryState } from '../../domains/delivery/types.js';
import { atomicWriteJson, atomicWriteText } from '../filesystem/atomic-write.js';
import { RecoverableFileTransition } from '../runtime/recoverable-file-transition.js';
import { deliveryStateSchemaVersion, FileDeliveryV3Store } from './file-delivery-v3-store.js';

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

function deliveryState(value: unknown): DeliveryState {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (value as { schemaVersion?: unknown }).schemaVersion !== 2
  ) {
    throw new Error('Unsupported Delivery state schema: migration_required');
  }
  return value as DeliveryState;
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
    return (await exists(file)) ? deliveryState(await readJson<unknown>(file)) : null;
  }
  async list(): Promise<DeliveryState[]> {
    const root = path.join(path.resolve(this.workspaceRoot), '.repoctopus', 'deliveries');
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const states: DeliveryState[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        !/^[a-z0-9][a-z0-9-]{2,127}$/.test(entry.name)
      )
        continue;
      if ((await deliveryStateSchemaVersion(this.workspaceRoot, entry.name)) !== 2) continue;
      const state = await this.load(entry.name);
      if (state) states.push(state);
    }
    return states;
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

  async approvedEvidenceBundleIds(): Promise<string[]> {
    const protectedIds = new Set<string>();
    const states = [
      ...(await this.list()),
      ...(await new FileDeliveryV3Store(this.workspaceRoot).list()),
    ];
    for (const state of states) {
      if (
        state.snapshot &&
        state.approval?.decision === 'approve' &&
        state.approval.snapshotDigest === state.snapshot.digest &&
        ['approved', 'publishing', 'partially_published', 'in_review', 'merged'].includes(
          state.status,
        )
      ) {
        for (const bundleId of state.snapshot.evidenceBundleIds) protectedIds.add(bundleId);
      }
    }
    return [...protectedIds].sort();
  }

  async commit(options: {
    state: DeliveryState;
    previousStateVersion: number | null;
    event: DeliveryEvent;
  }): Promise<void> {
    const paths = this.paths(options.state.changeId);
    await this.transition(paths).run(
      (journal) => this.replay(paths, journal),
      async (transition) => {
        const current = (await exists(paths.state))
          ? deliveryState(await readJson<unknown>(paths.state))
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
        await transition.commit(
          journal,
          (pending) => this.complete(paths, pending),
          (pending) => this.hooks.afterJournalWritten?.(pending),
        );
      },
    );
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
    await this.transition(paths).recover((journal) => this.replay(paths, journal));
  }
  private async replay(
    paths: ReturnType<FileDeliveryStore['paths']>,
    journal: DeliveryJournal,
  ): Promise<void> {
    deliveryState(journal.nextState);
    if (journal.schemaVersion !== 1) throw new Error('Invalid delivery journal');
    await this.complete(paths, journal);
  }

  private transition(
    paths: ReturnType<FileDeliveryStore['paths']>,
  ): RecoverableFileTransition<DeliveryJournal> {
    return new RecoverableFileTransition(paths.lock, paths.journal);
  }
}
