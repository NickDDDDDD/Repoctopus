import { describe, expect, it } from 'vitest';

import { startRun } from '../domains/engine/loop.js';
import { projectWorkflowMeasurements } from '../domains/telemetry/measurements.js';
import type { TrajectoryEvent } from '../domains/trajectory/types.js';
import { compositionFixture, projectFixture, workflowFixture } from './helpers/fixtures.js';

function trajectoryEvent(
  sequence: number,
  type: TrajectoryEvent['type'],
  data: Record<string, unknown>,
): TrajectoryEvent {
  return {
    schemaVersion: 1,
    sequence,
    eventId: `runtime-${sequence}`,
    timestamp: `2026-11-02T00:00:0${sequence}.000Z`,
    type,
    runId: 'runtime-telemetry',
    stateVersion: sequence,
    compositionDigest: compositionFixture().compositionDigest,
    data,
  };
}

describe('authoritative workflow telemetry', () => {
  it('projects one stable start and one terminal duration from persisted trajectory facts', () => {
    const workflow = workflowFixture();
    const projectSnapshot = projectFixture();
    const run = startRun({
      workflow,
      runId: 'runtime-telemetry',
      projectSnapshotDigest: projectSnapshot.digest,
      composition: compositionFixture(),
      timestamp: '2026-11-02T00:00:00.000Z',
    });
    const started = trajectoryEvent(1, 'run.started', {});
    const terminal = trajectoryEvent(8, 'change.lifecycle.transitioned', {
      changeLifecycleTransition: { to: { status: 'completed' } },
    });
    const base = { run, workflow, projectSnapshot, trajectory: [started, terminal] };
    const first = projectWorkflowMeasurements({
      ...base,
      events: [started, terminal],
    });
    const replay = projectWorkflowMeasurements({
      ...base,
      events: [started, terminal],
    });
    expect(first).toMatchObject([
      { result: 'started', durationMs: null },
      { result: 'completed', durationMs: 7_000 },
    ]);
    expect(first.map((item) => item.measurementId)).toEqual(
      replay.map((item) => item.measurementId),
    );
  });
});
