import { describe, expect, it } from 'vitest';

import {
  OBSERVATION_COVERAGE_MATRIX,
  OBSERVATION_PHASES,
  observationEventSchema,
  validateObservationAttributes,
  validateObservationMetricAttributes,
} from '../domains/telemetry/observation-contract.js';

describe('observation telemetry contract', () => {
  it('covers every approved workflow fact with versioned Log, Span, and Metric policy', () => {
    expect(Object.keys(OBSERVATION_COVERAGE_MATRIX)).toEqual([
      'phase',
      'work',
      'task',
      'skill',
      'decision',
      'tool-host',
      'validator-evidence',
      'recovery',
      'telemetry-pipeline',
    ]);
    expect(OBSERVATION_PHASES).toEqual(['open', 'design', 'build', 'verify', 'archive']);

    for (const coverage of Object.values(OBSERVATION_COVERAGE_MATRIX)) {
      expect(coverage.events.length).toBeGreaterThan(0);
      for (const eventName of coverage.events) {
        const schema = observationEventSchema(eventName);
        expect(schema.schemaVersion).toBe(1);
        expect(schema.category).toBe(coverage.category);
        expect(schema.log).toEqual({ emit: true, correlation: 'trace-and-span' });
        expect(['point', 'boundary-start', 'boundary-end', 'none']).toContain(schema.span.strategy);
        expect(['counter', 'histogram', 'gauge', 'none']).toContain(schema.metric.instrument);
      }
    }
  });

  it('freezes exact Log and Span correlation for paired execution boundaries', () => {
    const started = observationEventSchema('validator.started');
    const completed = observationEventSchema('validator.completed');

    expect(started.span).toEqual({
      strategy: 'boundary-start',
      operation: 'validator',
      correlation: 'operation-id',
    });
    expect(completed.span).toEqual({
      strategy: 'boundary-end',
      operation: 'validator',
      correlation: 'operation-id',
    });
    expect(started.log.correlation).toBe('trace-and-span');
    expect(completed.log.correlation).toBe('trace-and-span');
  });

  it('keeps health Metric dimensions finite and identity-free', () => {
    const allowedDurationKinds = [
      'run',
      'phase-residency',
      'active-execution',
      'human-wait',
      'external-wait',
      'retry-wait',
      'validator',
      'reconcile',
    ];
    const allowedEventKinds = ['rework', 'retry', 'unknown', 'reconcile', 'recovery'];

    expect(new Set(allowedDurationKinds).size).toBe(allowedDurationKinds.length);
    expect(new Set(allowedEventKinds).size).toBe(allowedEventKinds.length);
    expect(allowedDurationKinds.join(' ')).not.toMatch(/runId|workId|taskId|validatorId/u);
    expect(allowedEventKinds.join(' ')).not.toMatch(/runId|workId|taskId|validatorId/u);
  });

  it('accepts only declared low-cardinality Metric dimensions', () => {
    expect(
      validateObservationMetricAttributes('work.completed', {
        phase: 'build',
        'work.kind': 'task.implement',
        result: 'succeeded',
      }),
    ).toEqual({ phase: 'build', 'work.kind': 'task.implement', result: 'succeeded' });

    expect(() =>
      validateObservationMetricAttributes('work.completed', {
        'work.id': 'build:2.1:1133872f2e84',
      }),
    ).toThrow(/metric dimension.*work\.id/iu);
    expect(() =>
      validateObservationMetricAttributes('work.completed', {
        result: 'the validator failed because a private command printed its token',
      }),
    ).toThrow(/metric dimension.*result/iu);

    expect(
      validateObservationMetricAttributes('telemetry.delivery-completed', {
        'destination.kind': 'remote',
        result: 'failed',
      }),
    ).toEqual({ 'destination.kind': 'remote', result: 'failed' });
    expect(() =>
      validateObservationMetricAttributes('telemetry.delivery-completed', {
        'destination.id': 'team-signoz',
      }),
    ).toThrow(/metric dimension.*destination\.id/iu);
  });

  it('rejects private or free-text Observation attributes before an envelope exists', () => {
    expect(
      validateObservationAttributes({
        'repoctopus.phase': 'build',
        'repoctopus.work.kind': 'task.implement',
        'repoctopus.event.sequence': 42,
      }),
    ).toEqual({
      'repoctopus.event.sequence': 42,
      'repoctopus.phase': 'build',
      'repoctopus.work.kind': 'task.implement',
    });

    for (const attributes of [
      { 'repoctopus.prompt': 'implement the private feature' },
      { 'repoctopus.command.output': 'npm token=secret' },
      { 'repoctopus.source.path': 'C:/Users/private/repository' },
      { 'repoctopus.decision.reply': 'approved with private context' },
      { 'repoctopus.note': 'free\ntext' },
    ]) {
      expect(() => validateObservationAttributes(attributes)).toThrow(/unsafe observation/iu);
    }
  });
});
