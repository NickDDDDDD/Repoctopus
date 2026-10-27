import { describe, expect, it } from 'vitest';

import { decodeOtlpJsonProjectionObservations } from '../app/desktop/host/otlp-json-projection.js';

const attribute = (key: string, value: string | number) => ({
  key,
  value: typeof value === 'number' ? { intValue: String(value) } : { stringValue: value },
});

describe('Desktop OTLP JSON projection decoder', () => {
  it('normalizes only allowlisted identities from a standard OTLP Log request', () => {
    const body = Buffer.from(
      JSON.stringify({
        resourceLogs: [
          {
            resource: { attributes: [attribute('repoctopus.workspace.id', 'workspace-a')] },
            scopeLogs: [
              {
                logRecords: [
                  {
                    timeUnixNano: '1793080800000000000',
                    body: { stringValue: 'skill.delivered' },
                    attributes: [
                      attribute('repoctopus.event.id', 'event-skill'),
                      attribute('repoctopus.event.sequence', 12),
                      attribute('repoctopus.change.id', 'change-a'),
                      attribute('repoctopus.run.id', 'run-a'),
                      attribute('repoctopus.workflow.name', 'repoctopus-change'),
                      attribute('repoctopus.execution.phase', 'build'),
                      attribute('repoctopus.execution.work.id', 'build-work'),
                      attribute('repoctopus.execution.work.kind', 'task.implement'),
                      attribute('repoctopus.execution.attempt', 2),
                      attribute('repoctopus.skill.name', 'tdd'),
                      attribute('repoctopus.skill.role', 'augmentation'),
                      attribute('repoctopus.task.id', '5.3'),
                      attribute('repoctopus.task.revision', `sha256:${'a'.repeat(64)}`),
                      attribute('repoctopus.execution.result', 'accepted'),
                      attribute('repoctopus.execution.prompt', 'private prompt'),
                      attribute('repoctopus.execution.command', 'private command'),
                    ],
                  },
                  {
                    timeUnixNano: '1793080800000000000',
                    body: { stringValue: 'Repoctopus Change lifecycle status event' },
                    attributes: [
                      attribute('repoctopus.event.id', 'transition-verify-failed'),
                      attribute('repoctopus.event.sequence', 21),
                      attribute('repoctopus.change.id', 'change-a'),
                      attribute('repoctopus.run.id', 'run-a'),
                      attribute('repoctopus.change.phase.before', 'verify'),
                      attribute('repoctopus.change.phase', 'build'),
                      attribute('repoctopus.change.status', 'running'),
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    const observations = decodeOtlpJsonProjectionObservations(body);
    expect(observations).toEqual([
      {
        schemaVersion: 1,
        sequence: 12,
        sequenceScope: 'workflow:run-a',
        affectsFreshness: true,
        eventId: 'event-skill',
        eventName: 'skill.delivered',
        observedAt: '2026-10-27T06:00:00.000Z',
        workspaceId: 'workspace-a',
        changeId: 'change-a',
        runId: 'run-a',
        workflowName: 'repoctopus-change',
        phase: 'build',
        work: { id: 'build-work', kind: 'task.implement', attempt: 2 },
        skill: { name: 'tdd', role: 'augmentation' },
        task: { id: '5.3', revision: `sha256:${'a'.repeat(64)}` },
        host: null,
        validator: null,
        continuation: null,
        recoverySourcePhase: null,
        previousPhase: null,
        lifecycleStatus: null,
        evidence: null,
        decision: null,
        blocker: null,
        result: 'accepted',
      },
    ]);
    expect(JSON.stringify(observations)).not.toMatch(/private prompt|private command/iu);
  });

  it('ignores malformed or uncorrelated OTLP records without inventing identity', () => {
    expect(decodeOtlpJsonProjectionObservations(Buffer.from('{broken'))).toEqual([]);
    expect(
      decodeOtlpJsonProjectionObservations(
        Buffer.from(JSON.stringify({ resourceLogs: [{ scopeLogs: [{ logRecords: [{}] }] }] })),
      ),
    ).toEqual([]);
  });

  it('normalizes the authoritative lifecycle phase signal, including a fallback source', () => {
    const body = Buffer.from(
      JSON.stringify({
        resourceLogs: [
          {
            resource: { attributes: [attribute('repoctopus.workspace.id', 'workspace-a')] },
            scopeLogs: [
              {
                logRecords: [
                  {
                    timeUnixNano: '1793080800000000000',
                    body: { stringValue: 'Repoctopus Change lifecycle phase event' },
                    attributes: [
                      attribute('repoctopus.event.id', 'transition-verify-failed'),
                      attribute('repoctopus.event.sequence', 21),
                      attribute('repoctopus.change.id', 'change-a'),
                      attribute('repoctopus.run.id', 'run-a'),
                      attribute('repoctopus.change.phase.before', 'verify'),
                      attribute('repoctopus.change.phase', 'build'),
                      attribute('repoctopus.change.status', 'running'),
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    const [observation] = decodeOtlpJsonProjectionObservations(body);
    expect(decodeOtlpJsonProjectionObservations(body)).toHaveLength(1);
    expect(observation?.eventName).toBe('change.phase.reopened');
    expect(observation?.phase).toBe('build');
    expect(observation?.previousPhase).toBe('verify');
    expect(observation?.recoverySourcePhase).toBe('verify');
    expect(observation?.lifecycleStatus).toBe('running');
  });

  it('decodes Task, Host, Validator and continuation facts only from their event attributes', () => {
    const record = (
      sequence: number,
      eventName: string,
      eventAttributes: ReturnType<typeof attribute>[],
    ) => ({
      timeUnixNano: '1793080800000000000',
      body: { stringValue: eventName },
      attributes: [
        attribute('repoctopus.event.id', `event-${sequence}`),
        attribute('repoctopus.event.sequence', sequence),
        attribute('repoctopus.change.id', 'change-a'),
        attribute('repoctopus.run.id', 'run-a'),
        attribute('repoctopus.execution.phase', 'build'),
        attribute('repoctopus.execution.work.id', 'build-work'),
        attribute('repoctopus.execution.work.kind', 'task.implement'),
        attribute('repoctopus.execution.attempt', 2),
        attribute('repoctopus.task.id', '5.3'),
        ...eventAttributes,
      ],
    });
    const body = Buffer.from(
      JSON.stringify({
        resourceLogs: [
          {
            resource: { attributes: [attribute('repoctopus.workspace.id', 'workspace-a')] },
            scopeLogs: [
              {
                logRecords: [
                  record(31, 'work.host-started', [
                    attribute('repoctopus.executor.id', 'external:cli:codex-root'),
                  ]),
                  record(32, 'validator.completed', [
                    attribute('repoctopus.validator.id', 'build.task-valid'),
                    attribute('repoctopus.execution.result', 'accepted'),
                  ]),
                  record(33, 'continuation.selected', [
                    attribute('repoctopus.next_action.kind', 'execute'),
                  ]),
                ],
              },
            ],
          },
        ],
      }),
    );

    const observations = decodeOtlpJsonProjectionObservations(body);
    expect(observations[0]?.host).toEqual({
      id: 'external:cli:codex-root',
      status: 'running',
    });
    expect(observations[1]?.validator).toEqual({
      id: 'build.task-valid',
      status: 'completed',
    });
    expect(observations[2]?.continuation).toBe('execute');
    expect(observations.every((observation) => observation.task?.id === '5.3')).toBe(true);
  });
});
