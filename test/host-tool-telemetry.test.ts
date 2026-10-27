import { describe, expect, it, vi } from 'vitest';

import {
  assertHostTelemetryReport,
  hostTelemetryFacts,
  type HostTelemetryReport,
} from '../domains/telemetry/host-tool-telemetry.js';
import type { WorkExecutionCheckpoint } from '../domains/work-execution/types.js';
import type { RunState } from '../domains/engine/types.js';
import type { TrajectoryEvent } from '../domains/trajectory/types.js';
import { ManagedWorkExecutor } from '../services/managed-work-executor.js';
import { WorkExecutionAuthority } from '../services/work-execution-authority.js';

const observed = {
  schemaVersion: 1,
  toolObservation: 'observed',
  tools: [
    {
      category: 'test.run',
      result: 'succeeded',
      durationMs: 1_250,
      callCount: 2,
    },
    {
      category: 'repository.search',
      result: 'succeeded',
      durationMs: 80,
      callCount: 4,
    },
  ],
  modelUsage: {
    modelVersion: 'gpt-5.1-2026-10-01',
    inputTokens: 1_000,
    outputTokens: 250,
    cacheReadTokens: 400,
    cacheWriteTokens: 100,
  },
} satisfies HostTelemetryReport;

describe('Host Tool telemetry contract', () => {
  it('projects a versioned observed report into bounded Tool and model facts', () => {
    expect(() => assertHostTelemetryReport(observed)).not.toThrow();
    expect(hostTelemetryFacts(observed)).toEqual([
      {
        kind: 'observation',
        observationStatus: 'observed',
      },
      {
        kind: 'tool-usage',
        category: 'test.run',
        result: 'succeeded',
        durationMs: 1_250,
        callCount: 2,
      },
      {
        kind: 'tool-usage',
        category: 'repository.search',
        result: 'succeeded',
        durationMs: 80,
        callCount: 4,
      },
      {
        kind: 'model-usage',
        modelVersion: 'gpt-5.1-2026-10-01',
        inputTokens: 1_000,
        outputTokens: 250,
        cacheReadTokens: 400,
        cacheWriteTokens: 100,
      },
    ]);
  });

  it('keeps an unsupported Host unknown instead of inventing zero usage', () => {
    expect(hostTelemetryFacts(undefined)).toEqual([
      {
        kind: 'observation',
        observationStatus: 'unknown',
      },
    ]);
    expect(hostTelemetryFacts(undefined)[0]).not.toHaveProperty('callCount');
    expect(hostTelemetryFacts(undefined)[0]).not.toHaveProperty('durationMs');
  });

  it.each([
    { ...observed, command: 'npm test' },
    { ...observed, path: 'C:\\private\\repo' },
    { ...observed, prompt: 'private prompt' },
    { ...observed, output: 'private output' },
    {
      ...observed,
      tools: [
        {
          category: 'runtime-operation',
          result: 'succeeded',
          durationMs: 10,
          callCount: 1,
        },
      ],
    },
  ])('rejects private content and Runtime-reserved categories: %#', (candidate) => {
    expect(() => assertHostTelemetryReport(candidate)).toThrow(/host telemetry report/iu);
  });
});

describe('Managed Work Host Tool observation', () => {
  const packetDigest = `sha256:${'a'.repeat(64)}` as const;
  const invocation = {
    schemaVersion: 1 as const,
    invocationId: 'invocation-1',
    host: {
      schemaVersion: 1 as const,
      id: 'external:cli:test-host',
      version: '1',
      codeDigest: `sha256:${'b'.repeat(64)}` as const,
      capabilities: [],
      actionKinds: ['agent' as const],
      reconcile: false,
    },
    packet: {
      schemaVersion: 1 as const,
      packetId: `sha256:${'c'.repeat(64)}` as const,
      packetDigest,
      contextDigest: `sha256:${'d'.repeat(64)}` as const,
    },
    startedAt: '2026-10-27T00:00:00.000Z',
  };

  function fixture() {
    const telemetry = vi
      .fn<
        (input: {
          intent: { intentId: string };
          invocationId: string;
          report: HostTelemetryReport | undefined;
        }) => Promise<void>
      >()
      .mockResolvedValue();
    const completed = vi.fn();
    const service = Object.create(ManagedWorkExecutor.prototype) as ManagedWorkExecutor;
    Object.defineProperty(service, 'ctx', {
      value: {
        runStore: {
          loadRun: vi.fn().mockResolvedValue({
            workExecution: {
              workId: 'build:2.6',
              attempt: 1,
              hostInvocation: invocation,
              packet: invocation.packet,
            } as unknown as WorkExecutionCheckpoint,
          }),
        },
        workExecutionAuthority: {
          loadIntent: vi.fn().mockResolvedValue({
            runId: 'run-1',
            intentId: 'intent-1',
          }),
          recordHostTelemetry: telemetry,
          markHostCompleted: completed,
          recordSkillFacts: vi.fn(),
        },
        workDispatcher: {
          resumeClaim: vi.fn().mockResolvedValue({ packet: { context: { layers: [] } } }),
          outcome: vi.fn().mockReturnValue({}),
          acceptOutcome: vi.fn().mockResolvedValue({ validation: 'pending' }),
        },
      },
    });
    return { service, telemetry, completed };
  }

  const input = {
    schemaVersion: 2 as const,
    runId: 'run-1',
    invocationId: invocation.invocationId,
    hostId: invocation.host.id,
    packetDigest,
    status: 'succeeded' as const,
    summary: 'bounded outcome',
    consumedLayerDigests: [],
  };

  it.each([
    ['observed', observed],
    ['unknown', undefined],
  ] as const)('persists %s availability before accepting the Host Outcome', async (_, report) => {
    const { service, telemetry, completed } = fixture();
    await service.acceptExternalOutcome({
      ...input,
      ...(report === undefined ? {} : { hostTelemetry: report }),
    });

    expect(telemetry).toHaveBeenCalledOnce();
    const recorded = telemetry.mock.calls[0]![0];
    expect(recorded.intent.intentId).toBe('intent-1');
    expect(recorded.invocationId).toBe('invocation-1');
    expect(recorded.report).toEqual(report);
    expect(telemetry.mock.invocationCallOrder[0]).toBeLessThan(
      completed.mock.invocationCallOrder[0]!,
    );
  });

  it('rejects a Host attempt to forge a Runtime protected operation', async () => {
    const { service, telemetry, completed } = fixture();
    await expect(
      service.acceptExternalOutcome({
        ...input,
        hostTelemetry: {
          ...observed,
          tools: [
            {
              category: 'runtime-operation',
              result: 'succeeded',
              durationMs: 1,
              callCount: 1,
            },
          ],
        } as never,
      }),
    ).rejects.toThrow(/host telemetry report/iu);
    expect(telemetry).not.toHaveBeenCalled();
    expect(completed).not.toHaveBeenCalled();
  });
});

describe('Host Tool trajectory facts', () => {
  function authorityFixture() {
    const execution = {
      schemaVersion: 3,
      workId: 'build:2.6',
      attempt: 1,
      checkEpoch: 24,
      executionContext: {
        schemaVersion: 1,
        phase: 'build',
        work: { id: 'build:2.6', kind: 'task.implement' },
        attempt: 1,
        checkEpoch: 24,
        task: { id: '2.6', revision: `sha256:${'e'.repeat(64)}` },
      },
      intentId: 'intent-1',
    } as unknown as WorkExecutionCheckpoint;
    let run = {
      runId: 'run-1',
      status: 'running',
      stateVersion: 1,
      composition: { compositionDigest: `sha256:${'f'.repeat(64)}` },
      changeLifecycle: {
        checkEpoch: 24,
        currentWork: { workId: 'build:2.6' },
      },
      workExecution: execution,
    } as unknown as RunState;
    const trajectory: TrajectoryEvent[] = [];
    const authority = Object.create(WorkExecutionAuthority.prototype) as WorkExecutionAuthority;
    Object.defineProperty(authority, 'ctx', {
      value: {
        runStore: {
          commitGuarded: vi.fn(
            <T>(
              _runId: string,
              reduce: (current: { state: RunState; trajectory: TrajectoryEvent[] }) => {
                state?: RunState;
                event?: TrajectoryEvent;
                value: T;
              },
            ): Promise<T> => {
              const reduced = reduce({ state: run, trajectory });
              if (reduced.state) run = reduced.state;
              if (reduced.event) trajectory.push(reduced.event);
              return Promise.resolve(reduced.value);
            },
          ),
          loadRun: vi.fn().mockRejectedValue(new Error('telemetry fixture has no exporter')),
          loadWorkflow: vi.fn().mockRejectedValue(new Error('telemetry fixture has no exporter')),
          loadProjectSnapshot: vi
            .fn()
            .mockRejectedValue(new Error('telemetry fixture has no exporter')),
          loadTrajectory: vi.fn().mockResolvedValue(trajectory),
          readTelemetryCursor: vi
            .fn()
            .mockRejectedValue(new Error('telemetry fixture has no exporter')),
        },
      },
    });
    return { authority, trajectory };
  }

  it('persists bounded observed aggregates with the authoritative Execution Context', async () => {
    const { authority, trajectory } = authorityFixture();
    await authority.recordHostTelemetry({
      intent: { runId: 'run-1', intentId: 'intent-1' } as never,
      invocationId: 'invocation-1',
      report: observed,
    });

    expect(trajectory.map((event) => event.type)).toEqual([
      'tool.observation-reported',
      'tool.usage-reported',
      'tool.usage-reported',
      'model.usage-reported',
    ]);
    expect(trajectory[1]?.data).toMatchObject({
      toolKind: 'host-tool',
      toolCategory: 'test.run',
      result: 'succeeded',
      durationMs: 1_250,
      callCount: 2,
      executionContext: {
        phase: 'build',
        work: { id: 'build:2.6' },
        task: { id: '2.6' },
      },
    });
  });

  it('persists one unknown capability fact and no invented usage for an unsupported Host', async () => {
    const { authority, trajectory } = authorityFixture();
    await authority.recordHostTelemetry({
      intent: { runId: 'run-1', intentId: 'intent-1' } as never,
      invocationId: 'invocation-1',
      report: undefined,
    });

    expect(trajectory).toHaveLength(1);
    expect(trajectory[0]).toMatchObject({
      type: 'tool.observation-reported',
      data: { toolKind: 'unknown', observationStatus: 'unknown' },
    });
    expect(trajectory[0]?.data).not.toHaveProperty('callCount');
    expect(trajectory[0]?.data).not.toHaveProperty('durationMs');
  });
});
