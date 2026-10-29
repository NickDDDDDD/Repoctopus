import { createHash } from 'node:crypto';
import { mkdir, open, readFile, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import {
  isObservationEnvelope,
  type ObservationEnvelope,
} from '../../../domains/trajectory/observation.js';
import {
  isChangeProjectionSnapshot,
  reduceChangeProjection,
  type ChangeProjectionSnapshot,
} from '../../../domains/trajectory/projection.js';
import { atomicWriteText } from '../../../platform/filesystem/atomic-write.js';

export const PROJECTION_BENCHMARK_BUDGET = Object.freeze({
  eventCount: 10_000,
  recoveryMs: 5_000,
  heapGrowthBytes: 256 * 1024 * 1024,
});
export const DEFAULT_PROJECTION_JOURNAL_POLICY = Object.freeze({
  maxEntries: 1_000,
  maxBytes: 4 * 1024 * 1024,
});
type Policy = Readonly<{ maxEntries: number; maxBytes: number }>;
type Diagnostic = Readonly<{
  kind: 'snapshot-corruption' | 'journal-corruption';
  line: number | null;
  message: string;
}>;
function checksum(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
async function optional(file: string) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
async function replace(file: string, contents: string) {
  await atomicWriteText(file, contents);
}
function snapshot(source: string): ChangeProjectionSnapshot {
  const value = JSON.parse(source) as {
    schemaVersion?: unknown;
    checksum?: unknown;
    projection?: unknown;
  };
  if (
    value.schemaVersion !== 1 ||
    !isChangeProjectionSnapshot(value.projection) ||
    value.checksum !== checksum(value.projection)
  )
    throw new Error('Projection snapshot checksum or schema is invalid');
  return structuredClone(value.projection);
}
function record(source: string): { journalSequence: number; observation: ObservationEnvelope } {
  const value = JSON.parse(source) as {
    schemaVersion?: unknown;
    journalSequence?: unknown;
    checksum?: unknown;
    observation?: unknown;
  };
  if (
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.journalSequence) ||
    !isObservationEnvelope(value.observation) ||
    value.checksum !== checksum(value.observation)
  )
    throw new Error('Projection journal checksum or schema is invalid');
  return value as { journalSequence: number; observation: ObservationEnvelope };
}
export class ProjectionJournalStore {
  private handle!: FileHandle;
  private entries = 0;
  private bytes = 0;
  private sequence = 0;
  private closed = false;
  private constructor(
    private readonly directory: string,
    private readonly policy: Policy,
    public snapshot: ChangeProjectionSnapshot,
    public readonly diagnostics: Diagnostic[],
  ) {}
  static async open(
    directory: string,
    initial: ChangeProjectionSnapshot,
    policy: Policy = DEFAULT_PROJECTION_JOURNAL_POLICY,
  ) {
    if (policy.maxEntries < 1 || policy.maxBytes < 1)
      throw new Error('Projection journal compaction thresholds must be positive');
    await mkdir(directory, { recursive: true });
    const diagnostics: Diagnostic[] = [];
    let projection = structuredClone(initial);
    const persisted = await optional(path.join(directory, 'projection.snapshot.json'));
    if (persisted)
      try {
        projection = snapshot(persisted);
      } catch (error) {
        diagnostics.push({ kind: 'snapshot-corruption', line: null, message: String(error) });
      }
    const journalFile = path.join(directory, 'projection.journal.jsonl');
    const source = (await optional(journalFile)) ?? '';
    let entries = 0;
    let sequence = 0;
    for (const [index, line] of source.split('\n').entries()) {
      if (!line) continue;
      entries += 1;
      try {
        const item = record(line);
        sequence = Math.max(sequence, item.journalSequence);
        projection = reduceChangeProjection(projection, item.observation).snapshot;
      } catch (error) {
        diagnostics.push({ kind: 'journal-corruption', line: index + 1, message: String(error) });
      }
    }
    const store = new ProjectionJournalStore(directory, { ...policy }, projection, diagnostics);
    store.entries = entries;
    store.bytes = Buffer.byteLength(source);
    store.sequence = sequence;
    store.handle = await open(journalFile, 'a');
    return store;
  }
  async append(observations: readonly ObservationEnvelope[], next: ChangeProjectionSnapshot) {
    if (this.closed) throw new Error('Projection journal is closed');
    const encoded = observations
      .map(
        (observation) =>
          JSON.stringify({
            schemaVersion: 1,
            journalSequence: ++this.sequence,
            checksum: checksum(observation),
            observation,
          }) + '\n',
      )
      .join('');
    if (encoded) {
      await this.handle.write(encoded, null, 'utf8');
      await this.handle.sync();
      this.entries += observations.length;
      this.bytes += Buffer.byteLength(encoded);
    }
    this.snapshot = structuredClone(next);
    if (this.entries >= this.policy.maxEntries || this.bytes >= this.policy.maxBytes)
      await this.compact(next);
  }
  async close(next: ChangeProjectionSnapshot, options: { compact?: boolean } = {}) {
    if (this.closed) return;
    if (options.compact !== false) await this.compact(next);
    await this.handle.close();
    this.closed = true;
  }
  private async compact(next: ChangeProjectionSnapshot) {
    await replace(
      path.join(this.directory, 'projection.snapshot.json'),
      JSON.stringify({ schemaVersion: 1, checksum: checksum(next), projection: next }) + '\n',
    );
    await this.handle.close();
    await replace(path.join(this.directory, 'projection.journal.jsonl'), '');
    this.handle = await open(path.join(this.directory, 'projection.journal.jsonl'), 'a');
    this.entries = 0;
    this.bytes = 0;
    this.sequence = 0;
    this.snapshot = structuredClone(next);
  }
}
