import { describe, expect, it } from 'vitest';

import {
  completeTelemetryDelivery,
  createTelemetryDestinationHealth,
  recordTelemetryReceiverEvaluation,
  recordTelemetryRetentionDrop,
  startTelemetryDelivery,
  telemetryDestinationMetricSamples,
} from '../domains/telemetry/pipeline-health.js';

const initial = (destinationId: string, kind: 'remote' | 'desktop') =>
  createTelemetryDestinationHealth({
    destinationId,
    destinationKind: kind,
    cursorOffset: 4,
    headOffset: 10,
    backlogCount: 6,
    backlogBytes: 6_000,
    oldestAgeMs: 30_000,
    observedAt: '2026-10-27T00:00:00.000Z',
  });

describe('per-destination telemetry pipeline health', () => {
  it('keeps a failed remote cursor independent from a successful desktop cursor', () => {
    const remoteBefore = initial('team-signoz', 'remote');
    const desktopBefore = initial('desktop-current-user', 'desktop');
    const domainResult = Object.freeze({ status: 'completed', receiptId: 'domain-receipt-1' });
    expect(
      startTelemetryDelivery(remoteBefore, {
        operationId: 'remote-attempt-1',
        observedAt: '2026-10-27T00:00:00.001Z',
      }),
    ).toMatchObject({
      eventName: 'telemetry.delivery-started',
      operationId: 'remote-attempt-1',
      destinationId: 'team-signoz',
      cursorLag: 6,
    });

    const remote = completeTelemetryDelivery(remoteBefore, {
      operationId: 'remote-attempt-1',
      result: 'failed',
      headOffset: 10,
      backlogCount: 6,
      backlogBytes: 6_000,
      oldestAgeMs: 31_200,
      deliveryLatencyMs: 1_200,
      observedAt: '2026-10-27T00:00:01.200Z',
    });
    const desktop = completeTelemetryDelivery(desktopBefore, {
      operationId: 'desktop-attempt-1',
      result: 'delivered',
      acknowledgedOffset: 10,
      headOffset: 10,
      backlogCount: 0,
      backlogBytes: 0,
      oldestAgeMs: 0,
      deliveryLatencyMs: 80,
      observedAt: '2026-10-27T00:00:00.080Z',
    });

    expect(remote.state).toMatchObject({
      destination: { id: 'team-signoz', kind: 'remote' },
      cursorOffset: 4,
      cursorLag: 6,
      backlog: { count: 6, bytes: 6_000, oldestAgeMs: 31_200 },
      lastResult: 'failed',
      retryCount: 1,
    });
    expect(desktop.state).toMatchObject({
      destination: { id: 'desktop-current-user', kind: 'desktop' },
      cursorOffset: 10,
      cursorLag: 0,
      backlog: { count: 0, bytes: 0, oldestAgeMs: 0 },
      lastResult: 'delivered',
      retryCount: 0,
    });
    expect(remote.fact).toMatchObject({
      eventName: 'telemetry.delivery-completed',
      destinationId: 'team-signoz',
      destinationKind: 'remote',
      result: 'failed',
      deliveryLatencyMs: 1_200,
      retryCount: 1,
    });
    expect(desktop.fact).toMatchObject({
      eventName: 'telemetry.delivery-completed',
      destinationId: 'desktop-current-user',
      destinationKind: 'desktop',
      result: 'delivered',
      deliveryLatencyMs: 80,
    });
    expect(remoteBefore.cursorOffset).toBe(4);
    expect(desktopBefore.cursorOffset).toBe(4);
    expect(domainResult).toEqual({ status: 'completed', receiptId: 'domain-receipt-1' });
  });

  it('records retention overflow as a durable gap before history is considered incomplete', () => {
    const overflow = recordTelemetryRetentionDrop(initial('team-signoz', 'remote'), {
      droppedCount: 3,
      droppedBytes: 2_400,
      headOffset: 12,
      backlogCount: 5,
      backlogBytes: 4_200,
      oldestAgeMs: 18_000,
      observedAt: '2026-10-27T00:01:00.000Z',
    });

    expect(overflow.state).toMatchObject({
      cursorOffset: 4,
      cursorLag: 8,
      gapCount: 1,
      retentionDroppedCount: 3,
      retentionDroppedBytes: 2_400,
      completeHistory: false,
    });
    expect(overflow.fact).toMatchObject({
      eventName: 'telemetry.gap-recorded',
      result: 'dropped',
      gapCount: 1,
      droppedCount: 3,
      droppedBytes: 2_400,
    });
  });

  it('records Receiver acceptance and rejection without free-text diagnostics', () => {
    const accepted = recordTelemetryReceiverEvaluation(initial('desktop', 'desktop'), {
      result: 'accepted',
      receiverLatencyMs: 12,
      observedAt: '2026-10-27T00:00:00.012Z',
    });
    const rejected = recordTelemetryReceiverEvaluation(accepted.state, {
      result: 'rejected',
      receiverLatencyMs: 4,
      observedAt: '2026-10-27T00:00:00.016Z',
    });

    expect(accepted.fact).toMatchObject({
      eventName: 'telemetry.receiver-evaluated',
      result: 'accepted',
      receiverLatencyMs: 12,
    });
    expect(rejected.state.receiver).toEqual({ result: 'rejected', latencyMs: 4 });
    expect(JSON.stringify(rejected)).not.toMatch(/body|response|reason|message/iu);
  });

  it('projects every health value with bounded destination-kind dimensions only', () => {
    const failed = completeTelemetryDelivery(initial('private-destination-id', 'remote'), {
      operationId: 'remote-attempt-1',
      result: 'failed',
      headOffset: 10,
      backlogCount: 6,
      backlogBytes: 6_000,
      oldestAgeMs: 31_200,
      deliveryLatencyMs: 1_200,
      observedAt: '2026-10-27T00:00:01.200Z',
    });
    const samples = telemetryDestinationMetricSamples(failed.state);

    expect(samples.map((sample) => sample.kind)).toEqual([
      'cursor-lag',
      'backlog-count',
      'backlog-bytes',
      'backlog-oldest-age',
      'retry-count',
      'gap-count',
      'retention-dropped-count',
      'retention-dropped-bytes',
      'delivery-latency',
    ]);
    expect(samples.every((sample) => sample.destinationKind === 'remote')).toBe(true);
    expect(JSON.stringify(samples)).not.toContain('private-destination-id');
  });

  it('rejects cursor regression and inconsistent backlog facts', () => {
    const state = initial('remote', 'remote');
    expect(() =>
      completeTelemetryDelivery(state, {
        operationId: 'bad-ack',
        result: 'delivered',
        acknowledgedOffset: 3,
        headOffset: 10,
        backlogCount: 7,
        backlogBytes: 7_000,
        oldestAgeMs: 30_000,
        deliveryLatencyMs: 10,
        observedAt: '2026-10-27T00:00:00.010Z',
      }),
    ).toThrow(/cursor/iu);
    expect(() =>
      completeTelemetryDelivery(state, {
        operationId: 'bad-backlog',
        result: 'delivered',
        acknowledgedOffset: 10,
        headOffset: 10,
        backlogCount: 1,
        backlogBytes: 10,
        oldestAgeMs: 1,
        deliveryLatencyMs: 10,
        observedAt: '2026-10-27T00:00:00.010Z',
      }),
    ).toThrow(/backlog/iu);
  });
});
