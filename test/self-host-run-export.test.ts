import { describe, expect, it, vi } from 'vitest';

import { decodeObservationOtlpJson } from '../app/desktop/host/otlp-envelope-codec.js';
import type { RunState } from '../domains/engine/types.js';
import type { ProjectSnapshot } from '../domains/project/types.js';
import type { TrajectoryEvent } from '../domains/trajectory/types.js';
import { exportSelfHostedRun, type SelfHostedRunSource } from '../scripts/self-host-run-export.js';

function event(sequence: number): TrajectoryEvent {
  return {
    schemaVersion: 1,
    sequence,
    eventId: `event-${sequence}`,
    timestamp: `2026-10-29T00:00:0${sequence}.000Z`,
    type: sequence === 1 ? 'work.created' : 'skill.delivered',
    runId: 'change-self-host-test',
    stateVersion: sequence,
    compositionDigest: `sha256:${'a'.repeat(64)}`,
    data:
      sequence === 1
        ? { phase: 'build', workId: 'build.execute:test', workKind: 'build.execute' }
        : {
            phase: 'build',
            workId: 'build.execute:test',
            skillName: 'tdd',
            skillRole: 'augmentation',
          },
  };
}

function source(): SelfHostedRunSource {
  return {
    loadRun: () =>
      Promise.resolve({
        workflowName: 'change-lifecycle-host',
        workflowVersion: '4.0.0',
        changeLifecycle: { identity: { changeId: 'desktop-dashboard' } },
      } as RunState),
    loadProjectSnapshot: () => Promise.resolve({ projectId: 'repoctopus' } as ProjectSnapshot),
    loadTrajectory: () => Promise.resolve([event(1), event(2)]),
  };
}

describe('self-host Run exporter', () => {
  it('replays immutable Runtime facts through canonical OTLP in bounded authenticated batches', async () => {
    const requests: Request[] = [];
    const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return Promise.resolve(new Response('{}', { status: 200 }));
    });

    const result = await exportSelfHostedRun({
      workspace: 'unused-with-injected-source',
      runId: 'change-self-host-test',
      endpoint: 'http://127.0.0.1:4318',
      token: 'test-session-token-at-least-24-characters',
      source: source(),
      fetch,
      batchSize: 1,
    });

    expect(result).toMatchObject({
      runId: 'change-self-host-test',
      workspaceId: 'repoctopus',
      changeId: 'desktop-dashboard',
      trajectoryEvents: 2,
      firstSequence: 1,
      lastSequence: 2,
      requestCount: 2,
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe('http://127.0.0.1:4318/v1/logs');
    expect(requests[0]?.headers.get('authorization')).toBe(
      'Bearer test-session-token-at-least-24-characters',
    );
    const observations = decodeObservationOtlpJson(
      new Uint8Array(await requests[0]!.arrayBuffer()),
    );
    expect(observations[0]).toMatchObject({
      eventType: 'work.created',
      identity: { runId: 'change-self-host-test', sequence: 1 },
      correlation: {
        workspaceId: 'repoctopus',
        changeId: 'desktop-dashboard',
        phase: 'build',
        workId: 'build.execute:test',
      },
    });
  });

  it('refuses to replay persisted Run data to a non-loopback destination', async () => {
    await expect(
      exportSelfHostedRun({
        workspace: 'unused-with-injected-source',
        runId: 'change-self-host-test',
        endpoint: 'https://telemetry.example.test',
        token: 'test-session-token-at-least-24-characters',
        source: source(),
      }),
    ).rejects.toThrow('IPv4 loopback');
  });
});
