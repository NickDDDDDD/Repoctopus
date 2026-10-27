import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  assertObservationEnvelopeIntegrity,
  createObservationEnvelope,
  serializeObservationEnvelope,
  type ObservationEnvelopeInput,
} from '../domains/telemetry/observation-envelope.js';

const input = (): ObservationEnvelopeInput => ({
  source: {
    eventId: 'event-work-completed-1',
    eventName: 'work.completed',
    observedAt: '2026-10-27T05:10:00.000Z',
  },
  correlation: {
    traceId: '1'.repeat(32),
    spanId: '2'.repeat(16),
  },
  resourceAttributes: {
    'service.name': 'repoctopus',
    'repoctopus.workspace.id': 'workspace-1',
  },
  recordAttributes: {
    'repoctopus.event.id': 'event-work-completed-1',
    'repoctopus.run.id': 'run-1',
    'repoctopus.execution.phase': 'build',
    'repoctopus.execution.work.id': 'build:3.1',
    'repoctopus.execution.work.kind': 'task.implement',
    'repoctopus.execution.result': 'succeeded',
  },
  metric: {
    value: 1,
    attributes: {
      phase: 'build',
      'work.kind': 'task.implement',
      result: 'succeeded',
    },
  },
});

describe('canonical observation envelope', () => {
  it('maps the same persisted fact to byte-identical immutable output', () => {
    const first = createObservationEnvelope(input());
    const reordered = input();
    reordered.resourceAttributes = {
      'repoctopus.workspace.id': 'workspace-1',
      'service.name': 'repoctopus',
    };
    reordered.recordAttributes = Object.fromEntries(
      Object.entries(reordered.recordAttributes).reverse(),
    );
    reordered.metric = {
      value: 1,
      attributes: { result: 'succeeded', 'work.kind': 'task.implement', phase: 'build' },
    };
    const second = createObservationEnvelope(reordered);
    const bytes = serializeObservationEnvelope(first);
    const golden = readFileSync(
      new URL('./fixtures/telemetry/observation-envelope.json', import.meta.url),
      'utf8',
    ).trim();

    expect(serializeObservationEnvelope(second)).toBe(bytes);
    expect(bytes).toBe(golden);
    expect(first.envelopeId).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(first.canonicalDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(first.records.map((record) => record.signal)).toEqual(['log', 'span', 'metric']);
    expect(first.records[0]).toMatchObject({
      signal: 'log',
      traceId: '1'.repeat(32),
      spanId: '2'.repeat(16),
    });
    expect(first.records[1]).toMatchObject({
      signal: 'span',
      strategy: 'point',
      traceId: '1'.repeat(32),
      spanId: '2'.repeat(16),
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.records)).toBe(true);
    expect(Object.isFrozen(first.records[0]?.attributes)).toBe(true);
    expect(() => assertObservationEnvelopeIntegrity(first)).not.toThrow();
  });

  it('detects a changed canonical payload even when the identity is retained', () => {
    const envelope = createObservationEnvelope(input());
    const tampered = {
      ...envelope,
      records: envelope.records.map((record) =>
        record.signal === 'metric' ? { ...record, value: 2 } : record,
      ),
    };
    expect(() => assertObservationEnvelopeIntegrity(tampered)).toThrow(/digest/iu);
  });

  it.each([
    ['credential key', 'repoctopus.authorization', 'Bearer abc.def.ghi'],
    ['absolute path', 'repoctopus.change.id', 'C:\\private\\workspace'],
    ['body', 'repoctopus.artifact.content', 'private specification body'],
    ['prompt', 'repoctopus.model.prompt', 'private user prompt'],
    ['reply', 'repoctopus.model.reply', 'private model reply'],
    ['command', 'repoctopus.tool.command', 'npm run private'],
    ['command output', 'repoctopus.tool.output', 'private command output'],
  ])('rejects private %s instead of silently storing it', (_label, key, value) => {
    const candidate = input();
    candidate.recordAttributes = { ...candidate.recordAttributes, [key]: value };
    expect(() => createObservationEnvelope(candidate)).toThrow(/unsafe observation/iu);
  });

  it('rejects unbounded Metric identities and invalid source schemas', () => {
    const highCardinality = input();
    highCardinality.metric = {
      value: 1,
      attributes: { ...highCardinality.metric!.attributes, runId: 'run-private' },
    };
    expect(() => createObservationEnvelope(highCardinality)).toThrow(/metric dimension/iu);

    const unknownEvent = input();
    unknownEvent.source.eventName = 'private.event';
    expect(() => createObservationEnvelope(unknownEvent)).toThrow(/event schema/iu);
  });

  it('requires a stable operation identity for boundary spans', () => {
    const boundary = input();
    boundary.source.eventName = 'work.host-completed';
    expect(() => createObservationEnvelope(boundary)).toThrow(/operation/iu);

    boundary.correlation.operationId = 'host-operation-1';
    boundary.metric = {
      value: 1_250,
      attributes: {
        phase: 'build',
        'work.kind': 'task.implement',
        result: 'succeeded',
      },
    };
    expect(createObservationEnvelope(boundary).records[1]).toMatchObject({
      signal: 'span',
      strategy: 'boundary-end',
      operation: 'host',
      operationId: 'host-operation-1',
    });
  });

  it('allows only the reviewed aggregate model Token counters', () => {
    const aggregate = input();
    aggregate.recordAttributes = {
      ...aggregate.recordAttributes,
      'repoctopus.model.input_token_count': 120,
      'repoctopus.model.cache_read_token_count': 40,
    };
    expect(createObservationEnvelope(aggregate).records[0]?.attributes).toMatchObject({
      'repoctopus.model.input_token_count': 120,
      'repoctopus.model.cache_read_token_count': 40,
    });

    aggregate.recordAttributes['repoctopus.model.token'] = 'private-token';
    expect(() => createObservationEnvelope(aggregate)).toThrow(/unsafe observation/iu);
  });
});
