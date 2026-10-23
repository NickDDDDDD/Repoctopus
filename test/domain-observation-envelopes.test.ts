import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { initialDeliveryStateV3 } from '../domains/delivery/v3.js';
import type { DeliveryEvent } from '../domains/delivery/ports.js';
import { startRun } from '../domains/engine/loop.js';
import type { PlatformEventTelemetryEvent } from '../domains/platform-events/ports.js';
import type { TelemetryBatch } from '../domains/runtime/types.js';
import { validateObservationEnvelope } from '../domains/telemetry/observation-envelope.js';
import type { TrajectoryEvent } from '../domains/trajectory/types.js';
import { mapDeliveryObservationEnvelope } from '../platform/telemetry/observation-delivery-mapping.js';
import { mapLifecycleObservationEnvelope } from '../platform/telemetry/observation-lifecycle-mapping.js';
import { mapPlatformEventObservationEnvelope } from '../platform/telemetry/observation-platform-event-mapping.js';
import { mapWorkflowObservationEnvelope } from '../platform/telemetry/observation-workflow-mapping.js';
import type { LifecycleTelemetryEvent } from '../services/lifecycle-diagnostics.js';
import { compositionFixture, projectFixture, workflowFixture } from './helpers/fixtures.js';

function postMergeEnvelope() {
  const workflow = workflowFixture();
  const projectSnapshot = projectFixture({ projectId: 'golden-project' });
  const run = startRun({
    workflow,
    runId: 'golden-post-merge-run',
    changeId: 'golden-change',
    projectSnapshotDigest: projectSnapshot.digest,
    composition: compositionFixture(),
    timestamp: '2026-10-23T10:03:00.000Z',
    traceId: '4'.repeat(32),
    trigger: {
      schemaVersion: 1,
      kind: 'post-merge',
      identityDigest: `sha256:${'a'.repeat(64)}`,
      facts: { changeId: 'golden-change' },
    },
  });
  const proposed: TrajectoryEvent = {
    schemaVersion: 1,
    sequence: 8,
    eventId: 'golden-post-merge-proposed',
    timestamp: '2026-10-23T10:03:00.000Z',
    type: 'action.proposed',
    runId: run.runId,
    stateVersion: 7,
    compositionDigest: run.composition.compositionDigest,
    data: {
      action: {
        id: 'golden-post-merge-action',
        type: 'call_tool',
        ref: 'post-merge.publish-change',
        stepId: 'publish',
      },
    },
  };
  const completed: TrajectoryEvent = {
    ...proposed,
    sequence: 9,
    eventId: 'golden-post-merge-completed',
    timestamp: '2026-10-23T10:03:01.250Z',
    type: 'action.completed',
    stateVersion: 8,
    data: {
      actionId: 'golden-post-merge-action',
      result: 'succeeded',
      actionReceiptId: 'b'.repeat(64),
      correlationReceiptId: `sha256:${'c'.repeat(64)}`,
    },
  };
  const batch: TelemetryBatch = {
    run,
    workflow,
    projectSnapshot,
    events: [completed],
    trajectory: [proposed, completed],
  };
  return mapWorkflowObservationEnvelope(batch, completed);
}

function envelopes() {
  const lifecycle: LifecycleTelemetryEvent = {
    schemaVersion: 1,
    sequence: 12,
    eventId: '1'.repeat(64),
    type: 'plugin.lifecycle',
    bootId: 'golden-boot',
    compositionDigest: `sha256:${'d'.repeat(64)}`,
    timestamp: '2026-10-23T10:00:00.000Z',
    phase: 'disposed',
    result: 'succeeded',
    pluginId: 'delivery-file',
  };
  const platformEvent: PlatformEventTelemetryEvent = {
    schemaVersion: 1,
    type: 'platform_event.dead_lettered',
    timestamp: '2026-10-23T10:01:00.000Z',
    envelopeId: `sha256:${'e'.repeat(64)}`,
    provider: 'github',
    source: 'primary',
    deliveryId: 'golden-delivery',
    eventType: 'pull_request',
    status: 'dead_letter',
    attempts: 3,
    stateVersion: 6,
    receiptId: `sha256:${'f'.repeat(64)}`,
    diagnostic: 'repository-not-mapped',
  };
  const deliveryState = initialDeliveryStateV3('golden-change', '2026-10-23T10:02:00.000Z');
  const deliveryEvent: DeliveryEvent = {
    schemaVersion: 1,
    eventId: 'golden-delivery-event',
    changeId: deliveryState.changeId,
    stateVersion: deliveryState.stateVersion,
    timestamp: deliveryState.updatedAt,
    type: 'delivery.action',
    data: {
      result: 'final-change-published',
      receiptDigest: `sha256:${'9'.repeat(64)}`,
      body: 'private specification body',
    },
  };

  return {
    lifecycle: mapLifecycleObservationEnvelope(lifecycle),
    platformEvent: mapPlatformEventObservationEnvelope(platformEvent),
    delivery: mapDeliveryObservationEnvelope(deliveryState, deliveryEvent),
    postMerge: postMergeEnvelope(),
  };
}

describe('remaining domain ObservationEnvelope mappings', () => {
  it('matches the versioned lifecycle, platform event, Delivery and Post-merge golden fixture', async () => {
    const expected = JSON.parse(
      await readFile(
        new URL('./fixtures/telemetry/remaining-domain-envelopes.v1.json', import.meta.url),
        'utf8',
      ),
    ) as unknown;
    const actual = envelopes();

    expect(actual).toEqual(expected);
    for (const envelope of Object.values(actual)) {
      expect(() => validateObservationEnvelope(envelope)).not.toThrow();
    }
  });

  it('never carries a private body into a shared envelope', () => {
    expect(JSON.stringify(envelopes())).not.toContain('private specification body');
  });
});
