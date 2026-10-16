import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';

import type { RunState } from '../../domains/engine/types.js';
import type { ProjectSnapshot } from '../../domains/project/types.js';
import type {
  Checkpoint,
  TelemetryDeliveryCursor,
  TrajectoryEvent,
  TransitionJournal,
} from '../../domains/trajectory/types.js';
import type { WorkflowPackage } from '../../domains/workflow-contract/types.js';
import { atomicWriteJson, atomicWriteText } from '../filesystem/atomic-write.js';
import { runPaths, type RunPaths } from './paths.js';

function emptyArtifactsDigest(): string {
  return createHash('sha256').update('{}').digest('hex');
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

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class TrajectoryCorruptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrajectoryCorruptionError';
  }
}

export interface RuntimeStoreHooks {
  afterJournalWritten?(journal: TransitionJournal): void | Promise<void>;
  afterTrajectoryWritten?(journal: TransitionJournal): void | Promise<void>;
  afterRunWritten?(journal: TransitionJournal): void | Promise<void>;
  afterCheckpointWritten?(journal: TransitionJournal): void | Promise<void>;
}

export async function readTrajectory(file: string): Promise<TrajectoryEvent[]> {
  if (!(await exists(file))) return [];
  const source = await readFile(file, 'utf8');
  if (source.length === 0) return [];
  if (!source.endsWith('\n')) {
    throw new TrajectoryCorruptionError('Trajectory is truncated: missing final newline');
  }
  const events: TrajectoryEvent[] = [];
  for (const [index, line] of source.trimEnd().split('\n').entries()) {
    let event: TrajectoryEvent;
    try {
      event = JSON.parse(line) as TrajectoryEvent;
    } catch {
      throw new TrajectoryCorruptionError(`Trajectory contains invalid JSON at line ${index + 1}`);
    }
    if (event.schemaVersion !== 1 || event.sequence !== index + 1 || !event.eventId) {
      throw new TrajectoryCorruptionError(
        `Trajectory sequence or schema is invalid at line ${index + 1}`,
      );
    }
    if (events.some((existing) => existing.eventId === event.eventId)) {
      throw new TrajectoryCorruptionError(`Trajectory contains duplicate event: ${event.eventId}`);
    }
    events.push(event);
  }
  return events;
}

async function writeTrajectory(file: string, events: readonly TrajectoryEvent[]): Promise<void> {
  await atomicWriteText(file, events.map((event) => JSON.stringify(event)).join('\n') + '\n');
}

function checkpointFor(state: RunState, event: TrajectoryEvent): Checkpoint {
  return {
    schemaVersion: 1,
    runId: state.runId,
    stateVersion: state.stateVersion,
    workflowDigest: state.workflowDigest,
    trajectoryOffset: event.sequence,
    projectSnapshotDigest: state.projectSnapshotDigest,
    artifactManifestDigest: emptyArtifactsDigest(),
    createdAt: event.timestamp,
  };
}

export class FileRuntimeStore {
  constructor(
    private readonly workspaceRoot: string,
    private readonly hooks: RuntimeStoreHooks = {},
  ) {}

  paths(runId: string): RunPaths {
    return runPaths(this.workspaceRoot, runId);
  }

  async initialize(options: {
    state: RunState;
    workflow: WorkflowPackage;
    projectSnapshot: ProjectSnapshot;
    event: TrajectoryEvent;
  }): Promise<void> {
    const paths = this.paths(options.state.runId);
    await this.withTransitionLock(paths, async () => {
      await this.recoverUnlocked(paths, options.state.runId);
      if (await exists(paths.run)) throw new Error(`Run already exists: ${options.state.runId}`);
      await Promise.all([
        atomicWriteJson(paths.workflow, options.workflow),
        atomicWriteJson(paths.projectSnapshot, options.projectSnapshot),
      ]);
      await this.commitUnlocked(paths, {
        state: options.state,
        event: options.event,
        previousStateVersion: null,
      });
    });
  }

  async loadRun(runId: string): Promise<RunState> {
    await this.recover(runId);
    return readJson<RunState>(this.paths(runId).run);
  }

  async loadWorkflow(runId: string): Promise<WorkflowPackage> {
    return readJson<WorkflowPackage>(this.paths(runId).workflow);
  }

  async loadProjectSnapshot(runId: string): Promise<ProjectSnapshot> {
    return readJson<ProjectSnapshot>(this.paths(runId).projectSnapshot);
  }

  async loadCheckpoint(runId: string): Promise<Checkpoint> {
    await this.recover(runId);
    return readJson<Checkpoint>(this.paths(runId).checkpoint);
  }

  async loadTrajectory(runId: string): Promise<TrajectoryEvent[]> {
    await this.recover(runId);
    return readTrajectory(this.paths(runId).trajectory);
  }

  async findEvent(runId: string, eventId: string): Promise<TrajectoryEvent | null> {
    return (await this.loadTrajectory(runId)).find((event) => event.eventId === eventId) ?? null;
  }

  async commit(options: {
    state: RunState;
    event: TrajectoryEvent;
    previousStateVersion: number | null;
  }): Promise<void> {
    const paths = this.paths(options.state.runId);
    await this.withTransitionLock(paths, async () => {
      await this.recoverUnlocked(paths, options.state.runId);
      await this.commitUnlocked(paths, options);
    });
  }

  private async commitUnlocked(
    paths: RunPaths,
    options: {
      state: RunState;
      event: TrajectoryEvent;
      previousStateVersion: number | null;
    },
  ): Promise<void> {
    if (options.event.runId !== options.state.runId) {
      throw new Error(
        `Cross-run event rejected: ${options.event.runId} cannot update ${options.state.runId}`,
      );
    }
    if (options.event.stateVersion !== options.state.stateVersion) {
      throw new Error('Event stateVersion does not match next Run state');
    }
    const runExists = await exists(paths.run);
    if (options.previousStateVersion === null) {
      if (runExists) throw new Error(`Run already exists: ${options.state.runId}`);
      if (options.state.stateVersion !== 0) {
        throw new Error('Initial Run stateVersion must be zero');
      }
    } else {
      if (!runExists) throw new Error(`Run does not exist: ${options.state.runId}`);
      const current = await readJson<RunState>(paths.run);
      if (current.stateVersion !== options.previousStateVersion) {
        throw new Error(
          `Stale stateVersion: expected ${current.stateVersion}, received ${options.previousStateVersion}`,
        );
      }
      if (options.state.stateVersion !== options.previousStateVersion + 1) {
        throw new Error('Run stateVersion must advance by exactly one');
      }
    }
    const checkpoint = checkpointFor(options.state, options.event);
    const journal: TransitionJournal = {
      schemaVersion: 1,
      operationId: options.event.eventId,
      runId: options.state.runId,
      previousStateVersion: options.previousStateVersion,
      nextState: options.state,
      event: options.event,
      checkpoint,
    };
    await atomicWriteJson(paths.transitionJournal, journal);
    await this.hooks.afterJournalWritten?.(journal);
    await this.complete(paths, journal);
  }

  private async complete(paths: RunPaths, journal: TransitionJournal): Promise<void> {
    const trajectory = await readTrajectory(paths.trajectory);
    const existing = trajectory.find((event) => event.eventId === journal.event.eventId);
    if (!existing) {
      if (journal.event.sequence !== trajectory.length + 1) {
        throw new Error(
          `Trajectory sequence mismatch: expected ${trajectory.length + 1}, received ${journal.event.sequence}`,
        );
      }
      await writeTrajectory(paths.trajectory, [...trajectory, journal.event]);
      await this.hooks.afterTrajectoryWritten?.(journal);
    } else if (existing.sequence !== journal.event.sequence) {
      throw new Error(`Trajectory event identity changed: ${journal.event.eventId}`);
    }
    await atomicWriteJson(paths.run, journal.nextState);
    await this.hooks.afterRunWritten?.(journal);
    await atomicWriteJson(paths.checkpoint, journal.checkpoint);
    await this.hooks.afterCheckpointWritten?.(journal);
    await rm(paths.transitionJournal, { force: true });
  }

  async recover(runId: string): Promise<boolean> {
    const paths = this.paths(runId);
    if (!(await exists(paths.transitionJournal))) return false;
    return this.withTransitionLock(paths, () => this.recoverUnlocked(paths, runId));
  }

  private async recoverUnlocked(paths: RunPaths, runId: string): Promise<boolean> {
    if (!(await exists(paths.transitionJournal))) return false;
    const journal = await readJson<TransitionJournal>(paths.transitionJournal);
    if (journal.schemaVersion !== 1 || journal.runId !== runId) {
      throw new Error(`Invalid transition journal for run: ${runId}`);
    }
    await this.complete(paths, journal);
    return true;
  }

  private async withTransitionLock<T>(paths: RunPaths, operation: () => Promise<T>): Promise<T> {
    await mkdir(paths.root, { recursive: true });
    let handle;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        handle = await open(paths.transitionLock, 'wx', 0o600);
        await handle.writeFile(
          `${JSON.stringify({ schemaVersion: 1, pid: process.pid, createdAt: new Date().toISOString() })}\n`,
          'utf8',
        );
        await handle.sync();
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try {
          const owner = await readJson<{ pid?: number; createdAt?: string }>(paths.transitionLock);
          const age = owner.createdAt
            ? Date.now() - Date.parse(owner.createdAt)
            : Number.POSITIVE_INFINITY;
          if (
            typeof owner.pid !== 'number' ||
            !processIsAlive(owner.pid) ||
            !Number.isFinite(age) ||
            age > 5 * 60_000
          ) {
            await rm(paths.transitionLock, { force: true });
            continue;
          }
        } catch (readError) {
          if ((readError as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw readError;
        }
        await wait(20);
      }
    }
    if (!handle) throw new Error(`Run transition is busy: ${paths.root}`);
    try {
      return await operation();
    } finally {
      await handle.close();
      await rm(paths.transitionLock, { force: true });
    }
  }

  async readTelemetryCursor(runId: string): Promise<TelemetryDeliveryCursor> {
    const paths = this.paths(runId);
    if (!(await exists(paths.telemetryCursor))) {
      return { schemaVersion: 1, runId, trajectoryOffset: 0, updatedAt: new Date(0).toISOString() };
    }
    return readJson<TelemetryDeliveryCursor>(paths.telemetryCursor);
  }

  async writeTelemetryCursor(cursor: TelemetryDeliveryCursor): Promise<void> {
    await atomicWriteJson(this.paths(cursor.runId).telemetryCursor, cursor);
  }

  async inspect(runId: string): Promise<{
    state: RunState | null;
    checkpoint: Checkpoint | null;
    trajectory: TrajectoryEvent[];
    cursor: TelemetryDeliveryCursor;
    pendingTransition: boolean;
  }> {
    const paths = this.paths(runId);
    const [state, checkpoint, trajectory, cursor, pendingTransition] = await Promise.all([
      exists(paths.run).then((present) => (present ? readJson<RunState>(paths.run) : null)),
      exists(paths.checkpoint).then((present) =>
        present ? readJson<Checkpoint>(paths.checkpoint) : null,
      ),
      readTrajectory(paths.trajectory),
      this.readTelemetryCursor(runId),
      exists(paths.transitionJournal),
    ]);
    return { state, checkpoint, trajectory, cursor, pendingTransition };
  }
}
