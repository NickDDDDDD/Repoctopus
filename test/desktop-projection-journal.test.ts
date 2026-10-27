import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createEmptyChangeProjection,
  reduceChangeProjection,
  type ChangeProjectionObservation,
} from '../domains/telemetry/change-projection.js';
import {
  PROJECTION_BENCHMARK_BUDGET,
  ProjectionJournalStore,
} from '../app/desktop/host/projection-journal-store.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'repoctopus-projection-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

function observation(sequence: number): ChangeProjectionObservation {
  return {
    schemaVersion: 1,
    sequence,
    eventId: `event-${sequence}`,
    eventName: sequence % 2 === 0 ? 'change.phase.completed' : 'change.phase.entered',
    observedAt: new Date(Date.UTC(2026, 9, 27, 0, 0, 0, sequence)).toISOString(),
    workspaceId: 'workspace-a',
    changeId: 'change-a',
    runId: 'run-a',
    workflowName: 'repoctopus-change',
    phase: 'build',
    work: null,
    skill: null,
    task: null,
    host: null,
    validator: null,
    continuation: null,
    recoverySourcePhase: null,
    previousPhase: null,
    lifecycleStatus: 'running',
    result: sequence % 2 === 0 ? 'succeeded' : null,
  };
}

function project(observations: readonly ChangeProjectionObservation[]) {
  return observations.reduce(
    (snapshot, item) => reduceChangeProjection(snapshot, item).snapshot,
    createEmptyChangeProjection(),
  );
}

describe('desktop projection journal', () => {
  it('recovers an atomic snapshot, converges duplicate delivery and removes temp files', async () => {
    const directory = await temporaryDirectory();
    const records = [observation(1), observation(2), observation(3)];
    const first = await ProjectionJournalStore.open(directory, createEmptyChangeProjection(), {
      maxEntries: 2,
      maxBytes: 1024,
    });
    await first.append(records, project(records));
    await first.close(project(records));

    const recovered = await ProjectionJournalStore.open(directory, createEmptyChangeProjection());
    expect(recovered.snapshot).toEqual(project(records));
    expect(recovered.diagnostics).toEqual([]);
    await recovered.append(
      [records[2]!],
      reduceChangeProjection(recovered.snapshot, records[2]!).snapshot,
    );
    await recovered.close(recovered.snapshot);

    expect((await readdir(directory)).filter((file) => file.includes('.tmp-'))).toEqual([]);
  });

  it('continues after a corrupted journal record and exposes a diagnostic sequence gap', async () => {
    const directory = await temporaryDirectory();
    const records = [observation(1), observation(2), observation(3)];
    const store = await ProjectionJournalStore.open(directory, createEmptyChangeProjection(), {
      maxEntries: 100,
      maxBytes: 1024 * 1024,
    });
    await store.append(records, project(records));
    await store.close(project(records), { compact: false });

    const journal = path.join(directory, 'projection.journal.jsonl');
    const lines = (await readFile(journal, 'utf8')).trimEnd().split('\n');
    lines[1] = '{corrupted';
    await writeFile(journal, `${lines.join('\n')}\n`, 'utf8');

    const recovered = await ProjectionJournalStore.open(directory, createEmptyChangeProjection());
    expect(recovered.snapshot.version).toBe(2);
    expect(recovered.snapshot.freshness.missingSequences).toContain(2);
    expect(recovered.diagnostics).toEqual([
      expect.objectContaining({ kind: 'journal-corruption', line: 2 }),
    ]);
    await recovered.close(recovered.snapshot);
  });

  it('meets the recorded high-volume recovery and heap budgets after threshold compaction', async () => {
    const directory = await temporaryDirectory();
    const records = Array.from({ length: PROJECTION_BENCHMARK_BUDGET.eventCount }, (_, index) =>
      observation(index + 1),
    );
    const snapshot = project(records);
    const store = await ProjectionJournalStore.open(directory, createEmptyChangeProjection(), {
      maxEntries: 1_000,
      maxBytes: 4 * 1024 * 1024,
    });
    await store.append(records, snapshot);
    await store.close(snapshot);

    const heapBefore = process.memoryUsage().heapUsed;
    const startedAt = performance.now();
    const recovered = await ProjectionJournalStore.open(directory, createEmptyChangeProjection());
    const elapsedMs = performance.now() - startedAt;
    const heapGrowthBytes = Math.max(0, process.memoryUsage().heapUsed - heapBefore);

    expect(recovered.snapshot.version).toBe(PROJECTION_BENCHMARK_BUDGET.eventCount);
    expect(elapsedMs).toBeLessThan(PROJECTION_BENCHMARK_BUDGET.recoveryMs);
    expect(heapGrowthBytes).toBeLessThan(PROJECTION_BENCHMARK_BUDGET.heapGrowthBytes);
    expect((await readFile(path.join(directory, 'projection.journal.jsonl'), 'utf8')).length).toBe(
      0,
    );
    await recovered.close(recovered.snapshot);
  }, 20_000);
});
