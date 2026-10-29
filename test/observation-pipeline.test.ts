import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ObservationEnvelope } from '../domains/trajectory/observation.js';
import { ObservationPipeline } from '../services/observation-pipeline.js';

function envelope(sequence: number): ObservationEnvelope {
  return {
    schemaVersion: 1,
    envelopeId: `sha256:${String(sequence).padStart(64, '0')}`,
    digest: `sha256:${String(sequence + 100).padStart(64, '0')}`,
    observedAt: `2026-10-28T00:00:0${sequence}.000Z`,
    eventType: 'work.completed',
    identity: { eventId: `event-${sequence}`, runId: 'run-1', sequence },
    correlation: {},
    attributes: {},
  };
}

describe('ObservationPipeline', () => {
  it('atomically deduplicates envelopes and advances destination cursors independently', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'repoctopus-envelope-'));
    try {
      const pipeline = await ObservationPipeline.open(directory);
      await pipeline.append([envelope(1), envelope(2), envelope(1)]);
      expect((await pipeline.pending('remote')).map((item) => item.identity.sequence)).toEqual([
        1, 2,
      ]);
      expect((await pipeline.pending('desktop')).map((item) => item.identity.sequence)).toEqual([
        1, 2,
      ]);

      await pipeline.acknowledge('remote', envelope(2).envelopeId);
      expect(await pipeline.pending('remote')).toEqual([]);
      expect((await pipeline.pending('desktop')).map((item) => item.identity.sequence)).toEqual([
        1, 2,
      ]);

      const recovered = await ObservationPipeline.open(directory);
      expect(await recovered.pending('remote')).toEqual([]);
      expect((await recovered.pending('desktop')).map((item) => item.identity.sequence)).toEqual([
        1, 2,
      ]);
      await recovered.acknowledge('desktop', envelope(1).envelopeId);
      expect((await recovered.pending('desktop')).map((item) => item.identity.sequence)).toEqual([
        2,
      ]);
      await recovered.acknowledge('desktop', envelope(2).envelopeId);
      await recovered.append([
        {
          ...envelope(1),
          envelopeId: `sha256:${'f'.repeat(64)}`,
          identity: { eventId: 'evidence-1', runId: 'evidence:attempt-1', sequence: 1 },
        },
      ]);
      expect((await recovered.pending('desktop')).map((item) => item.identity.eventId)).toEqual([
        'evidence-1',
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('governs enabled, paused and removed destinations with bounded retention and explicit gaps', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'repoctopus-envelope-governance-'));
    try {
      const pipeline = await ObservationPipeline.open(directory, { capacity: 2 });
      await pipeline.configureDestination('remote', 'enabled');
      await pipeline.configureDestination('desktop', 'paused');
      await pipeline.append([envelope(1), envelope(2), envelope(3)]);

      expect(await pipeline.status('desktop')).toMatchObject({
        mode: 'paused',
        backlog: 2,
        gap: { droppedEnvelopes: 1, firstRetainedSequence: 2 },
      });
      await pipeline.acknowledge('remote', envelope(2).envelopeId);
      const remoteCursor = (await pipeline.status('remote')).cursor;

      await pipeline.configureDestination('desktop', 'removed');
      await pipeline.append([envelope(4)]);
      expect(await pipeline.status('desktop')).toMatchObject({ mode: 'removed', backlog: 0 });
      expect((await pipeline.status('remote')).cursor).toBe(remoteCursor);

      await pipeline.recordAttempt('remote', {
        result: 'failed',
        attemptedAt: '2026-10-28T00:01:00.000Z',
        warningCode: 'unavailable',
      });
      expect(await pipeline.status('remote')).toMatchObject({
        lastAttempt: { result: 'failed', warningCode: 'unavailable' },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
