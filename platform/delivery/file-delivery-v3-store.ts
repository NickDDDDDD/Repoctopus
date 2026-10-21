import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import type { DeliveryEvent, DeliveryV3StorePort } from '../../domains/delivery/ports.js';
import type { DeliveryStateV3 } from '../../domains/delivery/types.js';
import { atomicWriteJson, atomicWriteText } from '../filesystem/atomic-write.js';
import { RecoverableFileTransition } from '../runtime/recoverable-file-transition.js';

interface DeliveryV3Journal {
  schemaVersion: 1;
  previousStateVersion: number | null;
  nextState: DeliveryStateV3;
  event: DeliveryEvent;
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function deliveryStateV3(value: unknown): DeliveryStateV3 {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (value as { schemaVersion?: unknown }).schemaVersion !== 3
  ) {
    throw new Error('Unsupported Delivery state schema: migration_required');
  }
  return value as DeliveryStateV3;
}

export class FileDeliveryV3Store implements DeliveryV3StorePort {
  constructor(private readonly workspaceRoot: string) {}

  private paths(changeId: string) {
    if (!/^[a-z0-9][a-z0-9-]{2,127}$/u.test(changeId)) {
      throw new Error(`Invalid change id: ${changeId}`);
    }
    const root = path.join(path.resolve(this.workspaceRoot), '.repoctopus', 'deliveries', changeId);
    return {
      state: path.join(root, 'state.json'),
      history: path.join(root, 'history.jsonl'),
      journal: path.join(root, 'transition.json'),
      lock: path.join(root, 'transition.lock'),
    };
  }

  async load(changeId: string): Promise<DeliveryStateV3 | null> {
    const paths = this.paths(changeId);
    await this.transition(paths).recover((journal) => this.replay(paths, journal));
    if (!(await exists(paths.state))) return null;
    return deliveryStateV3(JSON.parse(await readFile(paths.state, 'utf8')) as unknown);
  }

  async commit(options: {
    state: DeliveryStateV3;
    previousStateVersion: number | null;
    event: DeliveryEvent;
  }): Promise<void> {
    deliveryStateV3(options.state);
    const paths = this.paths(options.state.changeId);
    await this.transition(paths).run(
      (journal) => this.replay(paths, journal),
      async (transition) => {
        const current = (await exists(paths.state))
          ? deliveryStateV3(JSON.parse(await readFile(paths.state, 'utf8')) as unknown)
          : null;
        if (options.previousStateVersion === null) {
          if (current) throw new Error(`Delivery already exists: ${options.state.changeId}`);
        } else if (!current || current.stateVersion !== options.previousStateVersion) {
          throw new Error(`Stale Delivery state: ${options.state.changeId}`);
        }
        if (
          options.event.changeId !== options.state.changeId ||
          options.event.stateVersion !== options.state.stateVersion
        ) {
          throw new Error('Delivery event does not match state');
        }
        await transition.commit(
          {
            schemaVersion: 1,
            previousStateVersion: options.previousStateVersion,
            nextState: options.state,
            event: options.event,
          },
          (journal) => this.replay(paths, journal),
        );
      },
    );
  }

  private async replay(
    paths: ReturnType<FileDeliveryV3Store['paths']>,
    journal: DeliveryV3Journal,
  ): Promise<void> {
    if (journal.schemaVersion !== 1) throw new Error('Invalid Delivery v3 journal');
    deliveryStateV3(journal.nextState);
    const history = (await exists(paths.history)) ? await readFile(paths.history, 'utf8') : '';
    const events = history
      ? history
          .trimEnd()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as DeliveryEvent)
      : [];
    if (!events.some((item) => item.eventId === journal.event.eventId)) {
      await atomicWriteText(
        paths.history,
        [...events, journal.event].map((item) => JSON.stringify(item)).join('\n') + '\n',
      );
    }
    await atomicWriteJson(paths.state, journal.nextState);
  }

  private transition(
    paths: ReturnType<FileDeliveryV3Store['paths']>,
  ): RecoverableFileTransition<DeliveryV3Journal> {
    return new RecoverableFileTransition(paths.lock, paths.journal);
  }
}

export async function deliveryStateSchemaVersion(
  workspaceRoot: string,
  changeId: string,
): Promise<2 | 3 | null> {
  if (!/^[a-z0-9][a-z0-9-]{2,127}$/u.test(changeId)) {
    throw new Error(`Invalid change id: ${changeId}`);
  }
  const root = path.join(path.resolve(workspaceRoot), '.repoctopus', 'deliveries', changeId);
  for (const file of [path.join(root, 'state.json'), path.join(root, 'transition.json')]) {
    if (!(await exists(file))) continue;
    const value = JSON.parse(await readFile(file, 'utf8')) as {
      schemaVersion?: unknown;
      nextState?: { schemaVersion?: unknown };
    };
    const version = file.endsWith('transition.json')
      ? value.nextState?.schemaVersion
      : value.schemaVersion;
    if (version === 2 || version === 3) return version;
    throw new Error('Unsupported Delivery state schema: migration_required');
  }
  return null;
}
