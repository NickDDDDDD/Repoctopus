import { describe, expect, it } from 'vitest';

import {
  decodeObservationOtlpJson,
  encodeObservationOtlpJson,
} from '../app/desktop/host/otlp-envelope-codec.js';
import type { ObservationEnvelope } from '../domains/trajectory/observation.js';
import { TELEMETRY_ATTRIBUTES } from '../domains/telemetry/observation-contract.js';

const envelope: ObservationEnvelope = {
  schemaVersion: 1,
  envelopeId: `sha256:${'1'.repeat(64)}`,
  digest: `sha256:${'2'.repeat(64)}`,
  observedAt: '2026-11-02T00:00:00.000Z',
  eventType: 'skill.consumed',
  identity: { eventId: 'event-1', runId: 'run-1', sequence: 2 },
  correlation: {
    workspaceId: 'team-platform',
    changeId: 'telemetry',
    phase: 'build',
    workId: 'work-1',
    skillName: 'tdd',
    skillRole: 'augmentation',
  },
  attributes: { result: 'consumed', stateVersion: 3 },
};

function observation(
  sequence: number,
  eventType: string,
  correlation: ObservationEnvelope['correlation'],
  attributes: ObservationEnvelope['attributes'],
): ObservationEnvelope {
  return {
    ...envelope,
    envelopeId: `sha256:${String(sequence).repeat(64).slice(0, 64)}`,
    digest: `sha256:${String(sequence + 1)
      .repeat(64)
      .slice(0, 64)}`,
    eventType,
    identity: { eventId: `event-${sequence}`, runId: 'run-1', sequence },
    correlation,
    attributes,
  };
}

function payload(signal: 'trace' | 'log' | 'metric') {
  return JSON.parse(
    Buffer.from(
      encodeObservationOtlpJson([envelope], signal, {
        resourceAttributes: {
          'service.name': 'company-repoctopus',
          'service.namespace': 'developer-platform',
          'repoctopus.product.name': 'repoctopus',
        },
      }),
    ).toString('utf8'),
  ) as Record<string, unknown>;
}

describe('canonical OTLP envelope codec', () => {
  it('emits queryable resource and event attributes while remaining reversible for Desktop', () => {
    const log = payload('log');
    expect(JSON.stringify(log)).toContain('company-repoctopus');
    expect(JSON.stringify(log)).toContain('repoctopus.event.id');
    expect(JSON.stringify(log)).toContain('repoctopus.observation.correlation.skill_name');
    expect(decodeObservationOtlpJson(Buffer.from(JSON.stringify(log)))).toEqual([envelope]);
  });

  it('keeps metric labels bounded and excludes exact identities and the encoded envelope', () => {
    const metric = JSON.stringify(payload('metric'));
    expect(metric).toContain('repoctopus.observation');
    expect(metric).toContain('repoctopus.event.type');
    expect(metric).toContain('repoctopus.execution.phase');
    expect(metric).toContain('repoctopus.skill.role');
    expect(metric).not.toContain('repoctopus.observation.envelope');
    expect(metric).not.toContain('run-1');
    expect(metric).not.toContain('work-1');
    expect(metric).not.toContain('tdd');
  });

  it('projects persisted Skill, Rule and workflow facts into their public low-cardinality metrics', () => {
    const correctedSkill = observation(
      2,
      'skill.outcome-recorded',
      { skillName: 'team-tdd', skillRole: 'augmentation' },
      { skillCategory: 'team', result: 'corrected', correctionKind: 'outcome-rejection' },
    );
    const rule = observation(
      3,
      'validator.completed',
      { ruleId: 'rule-1', evaluatorId: 'evaluator-1' },
      {
        ruleCategory: 'builtin',
        ruleApplicable: true,
        ruleExpected: true,
        ruleTriggered: true,
        ruleResult: 'passed',
      },
    );
    const workflow = observation(
      4,
      'change.lifecycle.transitioned',
      {},
      {
        workflowName: 'change-lifecycle',
        workflowVersion: '1',
        workflowRunResult: 'completed',
        workflowRunDurationMs: 42,
      },
    );
    const encoded = JSON.parse(
      Buffer.from(
        encodeObservationOtlpJson([envelope, correctedSkill, rule, workflow], 'metric'),
      ).toString('utf8'),
    ) as Record<string, unknown>;
    const json = JSON.stringify(encoded);

    expect(json).toContain('repoctopus.skill.usage');
    expect(json).toContain('repoctopus.rule.evaluation');
    expect(json).toContain('repoctopus.workflow.run');
    expect(json).toContain('repoctopus.workflow.run.duration');
    expect(json).toContain('repoctopus.rule.result');
    expect(json).toContain('repoctopus.skill.correction.kind');
    expect(json).toContain('outcome-rejection');
    expect(json).not.toContain('rule-1');
    expect(json).not.toContain('evaluator-1');
  });

  it('projects Workflow, Work, Evidence, Lifecycle and Delivery through the canonical encoder', () => {
    const events = [
      observation(
        5,
        'tool.completed',
        { phase: 'build', workKind: 'build.execute', continuation: 'execute' },
        { workflowName: 'change-lifecycle', result: 'succeeded', durationMs: 12 },
      ),
      observation(
        6,
        'evidence.node.completed',
        { evidenceAttemptId: 'attempt-1' },
        { adapter: 'vitest', status: 'passed', durationMs: 23 },
      ),
      observation(7, 'application.boot.completed', {}, { lifecycle: 'boot', result: 'succeeded' }),
      observation(
        8,
        'delivery.action',
        { changeId: 'change-1' },
        { deliveryState: 'completed', result: 'succeeded' },
      ),
    ];
    const encoded = JSON.stringify(
      JSON.parse(
        Buffer.from(encodeObservationOtlpJson(events, 'metric')).toString('utf8'),
      ) as Record<string, unknown>,
    );

    for (const name of [
      'repoctopus.workflow.events',
      'repoctopus.workflow.step.duration',
      'repoctopus.work.execution.events',
      'repoctopus.work.execution.duration',
      'repoctopus.evidence.events',
      'repoctopus.evidence.node.duration',
      'repoctopus.lifecycle.events',
      'repoctopus.delivery.events',
    ]) {
      expect(encoded).toContain(name);
    }
  });

  it('keeps every encoded OTLP attribute discoverable in the public catalog', () => {
    const catalog = new Set(TELEMETRY_ATTRIBUTES.map((item) => item.name));
    for (const signal of ['trace', 'log', 'metric'] as const) {
      const encoded = JSON.stringify(payload(signal));
      const keys = [...encoded.matchAll(/"key":"([^"]+)"/gu)].map((match) => match[1]!);
      expect(keys.filter((key) => !catalog.has(key))).toEqual([]);
    }
  });
});
