import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, type FileHandle } from 'node:fs/promises';
import path from 'node:path';

import {
  reduceChangeProjection,
  type ChangeProjectionObservation,
  type ChangeProjectionSnapshot,
} from '../../../domains/telemetry/change-projection.js';

export const PROJECTION_BENCHMARK_BUDGET = Object.freeze({
  eventCount: 10_000,
  recoveryMs: 5_000,
  heapGrowthBytes: 256 * 1024 * 1024,
});

export const DEFAULT_PROJECTION_JOURNAL_POLICY = Object.freeze({
  maxEntries: 1_000,
  maxBytes: 4 * 1024 * 1024,
});

interface ProjectionJournalPolicy {
  readonly maxEntries: number;
  readonly maxBytes: number;
}

interface ProjectionSnapshotFile {
  schemaVersion: 1;
  checksum: string;
  projection: ChangeProjectionSnapshot;
}

interface ProjectionJournalRecord {
  schemaVersion: 1;
  journalSequence: number;
  checksum: string;
  observation: ChangeProjectionObservation;
}

export interface ProjectionRecoveryDiagnostic {
  readonly kind: 'snapshot-corruption' | 'journal-corruption';
  readonly line: number | null;
  readonly message: string;
}

function checksum(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function isSnapshot(value: unknown): value is ChangeProjectionSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ChangeProjectionSnapshot>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.version === 'number' &&
    Array.isArray(candidate.events) &&
    Array.isArray(candidate.changes) &&
    typeof candidate.freshness === 'object' &&
    candidate.freshness !== null
  );
}

function parseSnapshot(source: string): ChangeProjectionSnapshot {
  const parsed = JSON.parse(source) as Partial<ProjectionSnapshotFile>;
  if (
    parsed.schemaVersion !== 1 ||
    !isSnapshot(parsed.projection) ||
    parsed.checksum !== checksum(parsed.projection)
  ) {
    throw new Error('Projection snapshot checksum or schema is invalid');
  }
  return structuredClone(parsed.projection);
}

function parseJournalRecord(source: string): ProjectionJournalRecord {
  const parsed = JSON.parse(source) as Partial<ProjectionJournalRecord>;
  if (
    parsed.schemaVersion !== 1 ||
    !Number.isSafeInteger(parsed.journalSequence) ||
    parsed.journalSequence! < 1 ||
    typeof parsed.observation !== 'object' ||
    parsed.observation === null ||
    parsed.checksum !== checksum(parsed.observation)
  ) {
    throw new Error('Projection journal checksum or schema is invalid');
  }
  return parsed as ProjectionJournalRecord;
}

async function readOptional(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function atomicReplace(file: string, contents: string): Promise<void> {
  const temporary = `${file}.tmp-${randomUUID()}`;
  const handle = await open(temporary, 'wx');
  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, file);
}

export class ProjectionJournalStore {
  private journalHandle!: FileHandle;
  private journalEntries = 0;
  private journalBytes = 0;
  private journalSequence = 0;
  private closed = false;

  private constructor(
    private readonly directory: string,
    private readonly policy: ProjectionJournalPolicy,
    public snapshot: ChangeProjectionSnapshot,
    public readonly diagnostics: ProjectionRecoveryDiagnostic[],
  ) {}

  static async open(
    directory: string,
    initialSnapshot: ChangeProjectionSnapshot,
    policy: ProjectionJournalPolicy = DEFAULT_PROJECTION_JOURNAL_POLICY,
  ): Promise<ProjectionJournalStore> {
    if (policy.maxEntries < 1 || policy.maxBytes < 1) {
      throw new Error('Projection journal compaction thresholds must be positive');
    }
    await mkdir(directory, { recursive: true });
    const diagnostics: ProjectionRecoveryDiagnostic[] = [];
    const snapshotFile = path.join(directory, 'projection.snapshot.json');
    const journalFile = path.join(directory, 'projection.journal.jsonl');
    let projection = structuredClone(initialSnapshot);
    const snapshotSource = await readOptional(snapshotFile);
    if (snapshotSource !== null) {
      try {
        projection = parseSnapshot(snapshotSource);
      } catch (error) {
        diagnostics.push({
          kind: 'snapshot-corruption',
          line: null,
          message: error instanceof Error ? error.message : 'Projection snapshot is corrupt',
        });
      }
    }

    const journalSource = (await readOptional(journalFile)) ?? '';
    const lines = journalSource.split('\n');
    let journalEntries = 0;
    let journalSequence = 0;
    for (const [index, line] of lines.entries()) {
      if (line.length === 0) continue;
      journalEntries += 1;
      try {
        const record = parseJournalRecord(line);
        journalSequence = Math.max(journalSequence, record.journalSequence);
        projection = reduceChangeProjection(projection, record.observation).snapshot;
      } catch (error) {
        diagnostics.push({
          kind: 'journal-corruption',
          line: index + 1,
          message: error instanceof Error ? error.message : 'Projection journal is corrupt',
        });
      }
    }

    const store = new ProjectionJournalStore(directory, { ...policy }, projection, diagnostics);
    store.journalEntries = journalEntries;
    store.journalBytes = Buffer.byteLength(journalSource, 'utf8');
    store.journalSequence = journalSequence;
    store.journalHandle = await open(journalFile, 'a');
    return store;
  }

  async append(
    observations: readonly ChangeProjectionObservation[],
    snapshot: ChangeProjectionSnapshot,
  ): Promise<void> {
    if (this.closed) throw new Error('Projection journal is closed');
    if (observations.length === 0) {
      this.snapshot = structuredClone(snapshot);
      return;
    }
    const encoded = observations
      .map((observation) => {
        this.journalSequence += 1;
        const record: ProjectionJournalRecord = {
          schemaVersion: 1,
          journalSequence: this.journalSequence,
          checksum: checksum(observation),
          observation,
        };
        return `${JSON.stringify(record)}\n`;
      })
      .join('');
    await this.journalHandle.write(encoded, null, 'utf8');
    await this.journalHandle.sync();
    this.journalEntries += observations.length;
    this.journalBytes += Buffer.byteLength(encoded, 'utf8');
    this.snapshot = structuredClone(snapshot);
    if (
      this.journalEntries >= this.policy.maxEntries ||
      this.journalBytes >= this.policy.maxBytes
    ) {
      await this.compact(snapshot);
    }
  }

  async close(
    snapshot: ChangeProjectionSnapshot,
    options: { compact?: boolean } = {},
  ): Promise<void> {
    if (this.closed) return;
    if (options.compact !== false) await this.compact(snapshot);
    await this.journalHandle.close();
    this.closed = true;
  }

  private async compact(snapshot: ChangeProjectionSnapshot): Promise<void> {
    const snapshotFile = path.join(this.directory, 'projection.snapshot.json');
    const journalFile = path.join(this.directory, 'projection.journal.jsonl');
    const persisted: ProjectionSnapshotFile = {
      schemaVersion: 1,
      checksum: checksum(snapshot),
      projection: snapshot,
    };
    await atomicReplace(snapshotFile, `${JSON.stringify(persisted)}\n`);
    await this.journalHandle.close();
    await atomicReplace(journalFile, '');
    this.journalHandle = await open(journalFile, 'a');
    this.journalEntries = 0;
    this.journalBytes = 0;
    this.journalSequence = 0;
    this.snapshot = structuredClone(snapshot);
  }
}
