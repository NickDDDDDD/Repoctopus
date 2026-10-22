import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import {
  mapObservationEnvelope,
  validateObservationEnvelope,
  type ObservationFact,
  type ObservationMapping,
} from '../domains/telemetry/observation-envelope.js';

const fact: ObservationFact = {
  source: {
    domain: 'workflow',
    eventId: 'event-telemetry-1',
    eventType: 'action.completed',
    sequence: 7,
  },
  observedAt: '2026-10-23T08:15:30.000Z',
  attributes: {
    'repoctopus.project.id': 'repoctopus',
    'repoctopus.run.id': 'run-42',
    'repoctopus.workflow.name': 'self-hosted-development',
    'repoctopus.stage.name': 'C:/Users/private/change',
    'repoctopus.private.body': 'full specification body',
    'repoctopus.command.output': 'command output',
    'repoctopus.auth': 'Bearer private-token-value',
  },
};

const mapping: ObservationMapping = {
  allowedAttributes: [
    'repoctopus.workflow.name',
    'repoctopus.project.id',
    'repoctopus.run.id',
    'repoctopus.stage.name',
  ],
  signals: [
    { kind: 'trace', name: 'repoctopus.workflow.event' },
    { kind: 'log', name: 'repoctopus.workflow.event', severity: 'info' },
    { kind: 'metric', name: 'repoctopus.workflow.events', value: 1, unit: 'event' },
  ],
};

describe('ObservationEnvelope', () => {
  it('maps one fact deterministically to the versioned golden envelope', async () => {
    const expected = JSON.parse(
      await readFile(
        new URL('./fixtures/telemetry/workflow-envelope.v1.json', import.meta.url),
        'utf8',
      ),
    ) as unknown;
    const first = mapObservationEnvelope(fact, mapping);
    const second = mapObservationEnvelope(structuredClone(fact), structuredClone(mapping));

    expect(first).toEqual(expected);
    expect(second).toEqual(first);
    expect(() => validateObservationEnvelope(first)).not.toThrow();
  });

  it('exports only safe allowlisted metadata and detects stored payload mutation', () => {
    const envelope = mapObservationEnvelope(fact, mapping);
    const serialized = JSON.stringify(envelope);
    expect(serialized).not.toMatch(
      /C:\/Users|specification body|command output|Bearer|private-token-value/u,
    );
    expect(envelope.attributes).toEqual({
      'repoctopus.project.id': 'repoctopus',
      'repoctopus.run.id': 'run-42',
      'repoctopus.workflow.name': 'self-hosted-development',
    });

    const mutated = structuredClone(envelope);
    mutated.attributes['repoctopus.project.id'] = 'other-project';
    expect(() => validateObservationEnvelope(mutated)).toThrow(/integrity check/u);
  });

  it('rejects unsafe keys even when a caller accidentally adds them to an allowlist', () => {
    expect(() =>
      mapObservationEnvelope(fact, {
        ...mapping,
        allowedAttributes: [...mapping.allowedAttributes, 'repoctopus.command.output'],
      }),
    ).toThrow(/unsafe observation attribute allowlist/iu);
  });

  it('does not preserve undeclared source or signal fields', () => {
    const envelope = mapObservationEnvelope(
      {
        ...fact,
        source: { ...fact.source, body: 'private source body' } as typeof fact.source,
      },
      {
        ...mapping,
        signals: [
          {
            kind: 'log',
            name: 'repoctopus.workflow.event',
            severity: 'info',
            output: 'private command output',
          } as (typeof mapping.signals)[number],
        ],
      },
    );
    expect(JSON.stringify(envelope)).not.toMatch(/private source|private command/u);
  });
});
