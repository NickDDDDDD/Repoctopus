import { describe, expect, it } from 'vitest';

import {
  createApplicationObservationEnvelope,
  createDeliveryObservationEnvelope,
  createEvidenceObservationEnvelopes,
  createObservationEnvelope,
  type ObservationContext,
} from '../domains/trajectory/observation.js';
import type { EvidenceTelemetryBatch } from '../domains/evidence/telemetry.js';
import type { TrajectoryEvent } from '../domains/trajectory/types.js';

const context: ObservationContext = {
  workspaceId: 'team-platform',
  changeId: 'dashboard',
  workflowName: 'change-lifecycle',
  workflowVersion: '1.0.0',
};

function event(type: TrajectoryEvent['type'], data: Record<string, unknown> = {}): TrajectoryEvent {
  return {
    schemaVersion: 1,
    sequence: 7,
    eventId: 'event-7',
    timestamp: '2026-10-28T00:00:07.000Z',
    type,
    runId: 'run-dashboard',
    stateVersion: 7,
    compositionDigest: `sha256:${'a'.repeat(64)}`,
    data,
  };
}

describe('ObservationEnvelope', () => {
  it('maps the same fact to one stable, canonical and allowlisted envelope', () => {
    const source = event('work.host-completed', {
      phase: 'build',
      buildAction: 'execute',
      workId: 'build.execute:7',
      workKind: 'build.execute',
      taskId: '3.1',
      packageId: 'work-package:3',
      attempt: 2,
      hostId: 'host-1',
      validatorId: 'package-validator',
      result: 'succeeded',
      continuation: 'execute',
      prompt: 'private prompt',
      body: 'private body',
      commandOutput: 'private output',
      path: 'C:\\Users\\private\\source.ts',
      token: 'secret-token',
    });

    const first = createObservationEnvelope(source, context);
    const replay = createObservationEnvelope(structuredClone(source), structuredClone(context));
    expect(replay).toEqual(first);
    expect(first.identity).toEqual({
      eventId: 'event-7',
      runId: 'run-dashboard',
      sequence: 7,
    });
    expect(first.correlation).toMatchObject({
      workspaceId: 'team-platform',
      changeId: 'dashboard',
      phase: 'build',
      buildAction: 'execute',
      workId: 'build.execute:7',
      taskId: '3.1',
      attempt: 2,
      hostId: 'host-1',
      validatorId: 'package-validator',
      continuation: 'execute',
    });
    expect(JSON.stringify(first)).not.toMatch(
      /private prompt|private body|private output|C:\\\\Users|secret-token|prompt|commandOutput/u,
    );
  });

  it('preserves absence and supports all authoritative phase/build correlations', () => {
    const phases = ['open', 'design', 'build', 'verify', 'archive'] as const;
    const actions = ['configure', 'plan', 'plan-evidence', 'execute', 'check'] as const;
    for (const phase of phases) {
      expect(
        createObservationEnvelope(event('work.created', { phase }), context).correlation.phase,
      ).toBe(phase);
    }
    for (const buildAction of actions) {
      expect(
        createObservationEnvelope(event('work.created', { phase: 'build', buildAction }), context)
          .correlation.buildAction,
      ).toBe(buildAction);
    }
    expect(createObservationEnvelope(event('run.started'), context).correlation).not.toHaveProperty(
      'phase',
    );
  });

  it('correlates execution, skill, decision, verification and recovery facts without inventing fields', () => {
    const fixtures: Array<[TrajectoryEvent['type'], Record<string, unknown>, string]> = [
      ['work.claimed', { workId: 'work-1', workKind: 'build.execute', attempt: 2 }, 'workId'],
      ['work.created', { taskId: '3.2', taskRevision: 'revision-1' }, 'taskId'],
      ['work.host-started', { hostId: 'host-1' }, 'hostId'],
      ['validator.completed', { validatorId: 'validator-1' }, 'validatorId'],
      ['continuation.selected', { continuation: 'reconcile' }, 'continuation'],
      ['skill.resolved', { skillName: 'tdd', skillRole: 'augmentation' }, 'skillName'],
      ['wait.started', { waitId: 'decision-1', waitKind: 'human-decision' }, 'decisionId'],
      ['action.completed', { evidenceAttemptId: 'verify-attempt-1' }, 'evidenceAttemptId'],
      ['recovery.reconciled', {}, 'recovery'],
    ];
    for (const [type, data, key] of fixtures) {
      expect(createObservationEnvelope(event(type, data), context).correlation).toHaveProperty(key);
    }
    expect(createObservationEnvelope(event('run.resumed'), context).correlation).not.toHaveProperty(
      'workId',
    );
  });

  it('preserves bounded packet and Specification observations without sensitive content', () => {
    const recovered = createObservationEnvelope(
      event('work.packet-recovered', {
        phase: 'open',
        workId: 'open:1',
        attempt: 1,
        result: 'recovered',
        packetDigest: `sha256:${'b'.repeat(64)}`,
        prompt: 'private packet body',
        path: 'C:\\private\\packet.json',
      }),
      context,
    );
    expect(recovered.correlation.recovery).toBe('work.packet-recovered');
    expect(recovered.attributes.result).toBe('recovered');
    expect(JSON.stringify(recovered)).not.toMatch(/private packet|packet\.json|prompt|path/u);

    const artifacts = createObservationEnvelope(
      event('specification.artifacts-observed', {
        proposalStatus: 'ready',
        specsStatus: 'skipped',
        designStatus: 'ready',
        tasksStatus: 'missing',
        metadata: 'private provider metadata',
      }),
      context,
    );
    expect(artifacts.attributes).toMatchObject({
      proposalStatus: 'ready',
      specsStatus: 'skipped',
      designStatus: 'ready',
      tasksStatus: 'missing',
    });
    expect(JSON.stringify(artifacts)).not.toContain('private provider metadata');
  });

  it('derives Build action, fallback and Skill state from authoritative persisted facts', () => {
    const planEvidence = createObservationEnvelope(
      event('change.lifecycle.transitioned', {
        observationKind: 'build-plan-evidence-accepted',
        changeLifecycleTransition: {
          transitionId: 'transition-build-plan',
          revision: 3,
          from: { phase: 'design', status: 'completed' },
          to: { phase: 'build', status: 'running' },
          work: null,
          wait: null,
        },
      }),
      context,
    );
    expect(planEvidence.correlation).toMatchObject({
      phase: 'build',
      buildAction: 'plan-evidence',
    });
    expect(planEvidence.attributes).toMatchObject({
      transitionId: 'transition-build-plan',
      fromPhase: 'design',
      fromStatus: 'completed',
      toStatus: 'running',
      revision: 3,
    });

    const fallback = createObservationEnvelope(
      event('change.lifecycle.transitioned', {
        observationKind: 'build-fallback-applied',
        changeLifecycleTransition: { to: { phase: 'build' }, work: null, wait: null },
        observation: {
          invalidation: {
            classification: 'implementation_failure',
            packageId: 'work-package:4',
          },
        },
      }),
      context,
    );
    expect(fallback.correlation).toMatchObject({ phase: 'build', packageId: 'work-package:4' });
    expect(fallback.attributes).toMatchObject({
      observationKind: 'build-fallback-applied',
      findingKind: 'implementation_failure',
    });

    for (const [type, state] of [
      ['skill.resolved', 'resolved'],
      ['skill.delivered', 'delivered'],
      ['skill.consumed', 'consumed'],
    ] as const) {
      const skill = createObservationEnvelope(
        event(type, {
          phase: 'build',
          workId: 'build.execute:4',
          skillName: 'tdd',
          skillRole: 'team-guidance',
          bindingId: 'team-tdd-guidance',
          slotId: 'design-method',
          skillOrder: 2,
          replacedSkillName: 'codebase-design',
          skillCompositionDigest: `sha256:${'d'.repeat(64)}`,
          result: 'succeeded',
        }),
        context,
      );
      expect(skill.attributes.skillState).toBe(state);
      expect(skill.correlation).toMatchObject({
        skillRole: 'team-guidance',
        bindingId: 'team-tdd-guidance',
        slotId: 'design-method',
        skillOrder: 2,
        replacedSkillName: 'codebase-design',
        skillCompositionDigest: `sha256:${'d'.repeat(64)}`,
      });
      expect(JSON.stringify(skill)).not.toMatch(/skillContent|prompt|internalThought/u);
    }
  });

  it('normalizes Evidence, Delivery and application facts through the same canonical envelope', () => {
    const evidenceBatch: EvidenceTelemetryBatch = {
      schemaVersion: 1,
      runId: 'run-dashboard',
      attemptId: 'attempt-1',
      profileId: 'verify',
      compositionDigest: `sha256:${'a'.repeat(64)}`,
      events: [
        {
          schemaVersion: 1,
          sequence: 1,
          eventId: 'evidence-1',
          type: 'evidence.artifact.recorded',
          timestamp: '2026-10-28T00:00:08.000Z',
          runId: 'run-dashboard',
          attemptId: 'attempt-1',
          data: {
            receiptId: 'receipt-1',
            artifactDigest: `sha256:${'b'.repeat(64)}`,
            artifactType: 'report',
            path: 'C:\\private\\report.md',
          },
        },
      ],
    };
    const [evidence] = createEvidenceObservationEnvelopes(evidenceBatch, context);
    expect(evidence?.correlation).toMatchObject({ evidenceAttemptId: 'attempt-1' });
    expect(JSON.stringify(evidence)).not.toContain('C:\\private');

    const delivery = createDeliveryObservationEnvelope(
      {
        schemaVersion: 1,
        eventId: 'delivery-1',
        changeId: 'dashboard',
        stateVersion: 4,
        timestamp: '2026-10-28T00:00:09.000Z',
        type: 'delivery.refreshed',
        data: { result: 'succeeded', webhook: 'private', post_merge: true },
      },
      context,
    );
    expect(delivery.attributes.result).toBe('succeeded');
    expect(JSON.stringify(delivery)).not.toMatch(/webhook|post_merge/u);

    const application = createApplicationObservationEnvelope({
      eventId: 'desktop-ready-1',
      runId: 'run-dashboard',
      observedAt: '2026-10-28T00:00:10.000Z',
      eventType: 'application.desktop.ready',
      context,
      attributes: { platform: 'win32', lifecycle: 'ready', path: 'C:\\private' },
    });
    expect(application.attributes).toEqual({ lifecycle: 'ready', platform: 'win32' });
  });
});
