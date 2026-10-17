import { describe, expect, it } from 'vitest';

import { initialDeliveryState } from '../domains/delivery/state.js';
import type { DeliveryEvent } from '../domains/delivery/ports.js';
import { safeDeliveryAttributes } from '../platform/telemetry/delivery-mapping.js';

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
    const attributes = safeDeliveryAttributes(state, event);
    expect(attributes).toMatchObject({
      'repoctopus.delivery.actionId': 'action',
      'repoctopus.delivery.actionType': 'git.push',
      'repoctopus.delivery.result': 'failed',
    });
    const serialized = JSON.stringify(attributes);
    expect(serialized).not.toMatch(/ghp_|C:\/private|example\.com|source code|secret/);
  });
});
