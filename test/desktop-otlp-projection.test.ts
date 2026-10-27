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
                      attribute('repoctopus.execution.skillName', 'tdd'),
                      attribute('repoctopus.execution.skillRole', 'augmentation'),
                      attribute('repoctopus.execution.result', 'accepted'),
                      attribute('repoctopus.execution.prompt', 'private prompt'),
                      attribute('repoctopus.execution.command', 'private command'),
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
});
