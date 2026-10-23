import { describe, expect, it } from 'vitest';

import { mapObservationEnvelope } from '../domains/telemetry/observation-envelope.js';
import { decodeDesktopOtlpBatch } from '../platform/telemetry/desktop-otlp-decoder.js';
import { encodeObservationOtlpJson } from '../platform/telemetry/observation-otlp-json.js';

describe('Desktop OTLP decoder routing', () => {
  it('ignores valid remote-only Workflow telemetry without a trusted Change binding', () => {
    const envelope = mapObservationEnvelope(
      {
        source: {
          domain: 'workflow',
          eventId: 'event-without-change',
          eventType: 'run.started',
          sequence: 1,
        },
        observedAt: '2026-10-23T09:20:00.000Z',
        attributes: {
          'repoctopus.workspace.id': 'workspace',
          'repoctopus.run.id': 'run-without-change',
        },
      },
      {
        allowedAttributes: ['repoctopus.workspace.id', 'repoctopus.run.id'],
        signals: [{ kind: 'log', name: 'repoctopus.run.started', severity: 'info' }],
      },
    );
    const logs = encodeObservationOtlpJson([envelope]).find((request) => request.signal === 'logs');
    if (!logs) throw new Error('Log payload was not encoded');

    expect(decodeDesktopOtlpBatch({ signal: 'logs', payload: logs.payload })).toEqual([]);
  });
});
