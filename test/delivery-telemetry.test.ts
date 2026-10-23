import { describe, expect, it } from 'vitest';

import { initialDeliveryState } from '../domains/delivery/state.js';
import type { DeliveryEvent } from '../domains/delivery/ports.js';
import type { DeliveryState } from '../domains/delivery/types.js';
import {
  deliveryObservationAttributes,
  mapDeliveryObservationEnvelope,
} from '../platform/telemetry/observation-delivery-mapping.js';

describe('delivery telemetry minimization', () => {
  it('exports allowlisted dimensions without report, path, URL, or credentials', () => {
    const state = initialDeliveryState('delivery-change', '2026-01-01T00:00:00.000Z');
    const event: DeliveryEvent = {
      schemaVersion: 1,
      eventId: 'event',
      changeId: state.changeId,
      stateVersion: state.stateVersion,
      timestamp: state.updatedAt,
      type: 'delivery.action',
      data: {
        actionId: 'action',
        actionType: 'git.push',
        result: 'failed',
        token: 'ghp_12345678901234567890',
        path: 'C:/private',
        url: 'https://token@example.com/repo',
        report: 'source code',
        body: 'secret',
      },
    };
    const attributes = deliveryObservationAttributes(state, event);
    expect(attributes).toMatchObject({
      'repoctopus.delivery.actionId': 'action',
      'repoctopus.delivery.actionType': 'git.push',
      'repoctopus.delivery.result': 'failed',
    });
    const serialized = JSON.stringify(attributes);
    expect(serialized).not.toMatch(/ghp_|C:\/private|example\.com|source code|secret/);
    expect(JSON.stringify(mapDeliveryObservationEnvelope(state, event))).not.toMatch(
      /ghp_|C:\/private|example\.com|source code|secret/,
    );
  });

  it('maps a persisted Human Decision as a blocker with an authoritative next action', () => {
    const state: DeliveryState = {
      ...initialDeliveryState('delivery-decision', '2026-10-23T12:30:00.000Z'),
      stateVersion: 1,
      status: 'awaiting_approval',
      decisionRequest: {
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'HumanDecisionRequest',
        requestId: 'request-delivery-approval',
        decisionType: 'delivery-approval',
        changeId: 'delivery-decision',
        snapshotDigest: `sha256:${'a'.repeat(64)}`,
        reportDigest: `sha256:${'b'.repeat(64)}`,
        evidenceBundleIds: [],
        repositories: [],
        changeMergeRequest: {
          role: 'change',
          repositoryId: 'workspace',
          remoteIdentity: 'example/workspace',
          sourceBranch: 'feat/delivery-decision',
          targetBranch: 'main',
          mergeRequest: {
            provider: 'github',
            repositoryId: 'workspace',
            number: 1,
            url: 'https://example.test/workspace/pull/1',
          },
        },
        actions: [],
        options: ['approve', 'request_changes', 'reject'],
      },
    };
    const event: DeliveryEvent = {
      schemaVersion: 1,
      eventId: 'event-delivery-decision',
      changeId: state.changeId,
      stateVersion: state.stateVersion,
      timestamp: state.updatedAt,
      type: 'delivery.prepared',
      data: {},
    };
    const envelope = mapDeliveryObservationEnvelope(state, event);
    expect(envelope.attributes).toMatchObject({
      'repoctopus.change.id': 'delivery-decision',
      'repoctopus.stage.name': 'delivery-approval',
      'repoctopus.task.id': 'request-delivery-approval',
      'repoctopus.task.status': 'blocked',
      'repoctopus.blocker.category': 'human-decision',
      'repoctopus.blocker.request.id': 'request-delivery-approval',
      'repoctopus.next_action.id': 'request-delivery-approval',
      'repoctopus.next_action.type': 'review-human-decision',
    });
    expect(envelope.observedAt).toBe(event.timestamp);
    for (const signal of envelope.signals) {
      if (signal.kind !== 'metric') continue;
      expect(JSON.stringify(signal.attributes ?? {})).not.toMatch(
        /delivery-decision|request-delivery-approval/u,
      );
    }
  });

  it('does not reinterpret an older Delivery event from newer mutable state', () => {
    const current: DeliveryState = {
      ...initialDeliveryState('delivery-stale', '2026-10-23T12:40:00.000Z'),
      stateVersion: 2,
      status: 'awaiting_approval',
      decisionRequest: {
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'HumanDecisionRequest',
        requestId: 'newer-request',
        decisionType: 'delivery-approval',
        changeId: 'delivery-stale',
        snapshotDigest: `sha256:${'c'.repeat(64)}`,
        reportDigest: `sha256:${'d'.repeat(64)}`,
        evidenceBundleIds: [],
        repositories: [],
        changeMergeRequest: {
          role: 'change',
          repositoryId: 'workspace',
          remoteIdentity: 'example/workspace',
          sourceBranch: 'feat/delivery-stale',
          targetBranch: 'main',
          mergeRequest: {
            provider: 'github',
            repositoryId: 'workspace',
            number: 2,
            url: 'https://example.test/workspace/pull/2',
          },
        },
        actions: [],
        options: ['approve', 'request_changes', 'reject'],
      },
    };
    const oldEvent: DeliveryEvent = {
      schemaVersion: 1,
      eventId: 'event-delivery-old',
      changeId: current.changeId,
      stateVersion: 1,
      timestamp: '2026-10-23T12:39:00.000Z',
      type: 'delivery.prepared',
      data: { nextAction: 'fabricated-next-action' },
    };
    const attributes = deliveryObservationAttributes(current, oldEvent);
    expect(attributes['repoctopus.change.id']).toBe('delivery-stale');
    expect(attributes).not.toHaveProperty('repoctopus.delivery.state');
    expect(attributes).not.toHaveProperty('repoctopus.delivery.repository.count');
    expect(attributes).not.toHaveProperty('repoctopus.blocker.request.id');
    expect(attributes).not.toHaveProperty('repoctopus.next_action.id');
    expect(JSON.stringify(attributes)).not.toMatch(/newer-request|fabricated-next-action/u);
  });
});
