import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectionJournalStore } from '../app/desktop/host/projection-journal-store.js';
import {
  createEmptyChangeProjection,
  reduceChangeProjection,
} from '../domains/trajectory/projection.js';
import type { ObservationEnvelope } from '../domains/trajectory/observation.js';

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);
function event(sequence: number): ObservationEnvelope {
  return {
    schemaVersion: 1,
    envelopeId: `sha256:${String(sequence).padStart(64, '0')}`,
    digest: `sha256:${String(sequence + 100).padStart(64, '0')}`,
    observedAt: new Date(1_800_000_000_000 + sequence).toISOString(),
    eventType: 'work.created',
    identity: { eventId: `event-${sequence}`, runId: 'run-1', sequence },
    correlation: {
      workspaceId: 'team',
      changeId: 'change',
      phase: 'build',
      workId: `work-${sequence}`,
    },
    attributes: {},
  };
}
function project(events: ObservationEnvelope[]) {
  return events.reduce(
    (state, item) => reduceChangeProjection(state, item).snapshot,
    createEmptyChangeProjection(),
  );
}

describe('desktop projection journal', () => {
  it('atomically recovers snapshots, converges duplicates and removes temporary files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'repoctopus-projection-'));
    roots.push(root);
    const events = [event(1), event(2), event(3)];
    const first = await ProjectionJournalStore.open(root, createEmptyChangeProjection(), {
      maxEntries: 2,
      maxBytes: 4096,
    });
    await first.append(events, project(events));
    await first.close(project(events));
    const recovered = await ProjectionJournalStore.open(root, createEmptyChangeProjection());
    expect(recovered.snapshot).toEqual(project(events));
    await recovered.append(
      [events[2]!],
      reduceChangeProjection(recovered.snapshot, events[2]!).snapshot,
    );
    await recovered.close(recovered.snapshot);
    expect((await readdir(root)).filter((name) => name.includes('.tmp-'))).toEqual([]);
  });

  it('reports corruption while continuing with valid journal records', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'repoctopus-projection-'));
    roots.push(root);
    const events = [event(1), event(2), event(3)];
    const store = await ProjectionJournalStore.open(root, createEmptyChangeProjection(), {
      maxEntries: 100,
      maxBytes: 100_000,
    });
    await store.append(events, project(events));
    await store.close(project(events), { compact: false });
    const file = path.join(root, 'projection.journal.jsonl');
    const lines = (await readFile(file, 'utf8')).trimEnd().split('\n');
    lines[1] = '{corrupt';
    await writeFile(file, lines.join('\n') + '\n');
    const recovered = await ProjectionJournalStore.open(root, createEmptyChangeProjection());
    expect(recovered.snapshot.version).toBe(2);
    expect(recovered.diagnostics).toContainEqual(
      expect.objectContaining({ kind: 'journal-corruption', line: 2 }),
    );
    await recovered.close(recovered.snapshot);
  });

  it('recovers a duplicate-heavy 10k event journal within the recorded resource budget', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'repoctopus-projection-'));
    roots.push(root);
    const observation = event(1);
    const observations = Array.from({ length: 10_000 }, () => observation);
    const expected = project([observation]);
    const store = await ProjectionJournalStore.open(root, createEmptyChangeProjection(), {
      maxEntries: 20_000,
      maxBytes: 128 * 1024 * 1024,
    });
    await store.append(observations, expected);
    await store.close(expected, { compact: false });

    const heapBefore = process.memoryUsage().heapUsed;
    const startedAt = performance.now();
    const recovered = await ProjectionJournalStore.open(root, createEmptyChangeProjection());
    const elapsedMs = performance.now() - startedAt;
    const heapGrowth = Math.max(0, process.memoryUsage().heapUsed - heapBefore);

    expect(recovered.snapshot).toEqual(expected);
    expect(elapsedMs).toBeLessThan(5_000);
    expect(heapGrowth).toBeLessThan(256 * 1024 * 1024);
    await recovered.close(recovered.snapshot);
  }, 15_000);
});
