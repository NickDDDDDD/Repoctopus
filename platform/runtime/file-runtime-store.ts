import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

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
import {
  RecoverableFileTransition,
  type FileTransitionContext,
} from './recoverable-file-transition.js';

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
    acceptedEvidenceBundleIds: [...state.acceptedEvidenceBundleIds],
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
    await this.transition(paths).run(
      (journal) => this.replay(paths, options.state.runId, journal),
      async (transition) => {
        if (await exists(paths.run)) throw new Error(`Run already exists: ${options.state.runId}`);
        await Promise.all([
          atomicWriteJson(paths.workflow, options.workflow),
          atomicWriteJson(paths.projectSnapshot, options.projectSnapshot),
        ]);
        await this.commitUnlocked(
          paths,
          { state: options.state, event: options.event, previousStateVersion: null },
          transition,
        );
      },
    );
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
    await this.transition(paths).run(
      (journal) => this.replay(paths, options.state.runId, journal),
      (transition) => this.commitUnlocked(paths, options, transition),
    );
  }

  async commitGuarded<T>(
    runId: string,
    operation: (current: {
      state: RunState;
      workflow: WorkflowPackage;
      trajectory: TrajectoryEvent[];
    }) => Promise<{
      state: RunState;
      event: TrajectoryEvent;
      value: T;
    }>,
  ): Promise<T> {
    const paths = this.paths(runId);
    return this.transition(paths).run(
      (journal) => this.replay(paths, runId, journal),
      async (transition) => {
        const [state, workflow, trajectory] = await Promise.all([
          readJson<RunState>(paths.run),
          readJson<WorkflowPackage>(paths.workflow),
          readTrajectory(paths.trajectory),
        ]);
        const result = await operation({ state, workflow, trajectory });
        await this.commitUnlocked(
          paths,
          {
            state: result.state,
            event: result.event,
            previousStateVersion: state.stateVersion,
          },
          transition,
        );
        return result.value;
      },
    );
  }

  private async commitUnlocked(
    paths: RunPaths,
    options: {
      state: RunState;
      event: TrajectoryEvent;
      previousStateVersion: number | null;
    },
    transition: FileTransitionContext<TransitionJournal>,
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
    await transition.commit(
      journal,
      (pending) => this.complete(paths, pending),
      (pending) => this.hooks.afterJournalWritten?.(pending),
    );
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
  }

  async recover(runId: string): Promise<boolean> {
    const paths = this.paths(runId);
    if (!(await exists(paths.transitionJournal))) return false;
    return this.transition(paths).recover((journal) => this.replay(paths, runId, journal));
  }

  private async replay(paths: RunPaths, runId: string, journal: TransitionJournal): Promise<void> {
    if (journal.schemaVersion !== 1 || journal.runId !== runId) {
      throw new Error(`Invalid transition journal for run: ${runId}`);
    }
    await this.complete(paths, journal);
  }

  private transition(paths: RunPaths): RecoverableFileTransition<TransitionJournal> {
    return new RecoverableFileTransition(paths.transitionLock, paths.transitionJournal);
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

  async evidenceRetentionState(): Promise<{
    deferred: boolean;
    acceptedBundleIds: string[];
  }> {
    const root = path.join(path.resolve(this.workspaceRoot), '.repoctopus', 'runs');
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { deferred: false, acceptedBundleIds: [] };
      }
      throw error;
    }
    const accepted = new Set<string>();
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const paths = this.paths(entry.name);
      if (await exists(paths.transitionJournal)) {
        return { deferred: true, acceptedBundleIds: [] };
      }
      if (!(await exists(paths.checkpoint))) continue;
      const checkpoint = await readJson<Checkpoint>(paths.checkpoint);
      if (
        checkpoint.schemaVersion !== 1 ||
        checkpoint.runId !== entry.name ||
        !Array.isArray(checkpoint.acceptedEvidenceBundleIds) ||
        checkpoint.acceptedEvidenceBundleIds.some(
          (bundleId) => typeof bundleId !== 'string' || bundleId.length === 0,
        )
      ) {
        throw new Error(`Invalid Runtime checkpoint evidence roots: ${entry.name}`);
      }
      for (const bundleId of checkpoint.acceptedEvidenceBundleIds) accepted.add(bundleId);
    }
    return { deferred: false, acceptedBundleIds: [...accepted].sort() };
  }
}
