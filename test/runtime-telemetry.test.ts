import { afterEach, describe, expect, it } from 'vitest';

import { WorkflowRunCoordinator } from '../domains/runtime/workflow-runs.js';
import { FileRuntimeStore } from '../platform/runtime/file-runtime-store.js';
import {
  compositionFixture,
  projectFixture,
  removeTemporaryDirectory,
  temporaryDirectory,
  workflowFixture,
} from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

describe('authoritative workflow telemetry', () => {
  it('persists one replay-safe start and one terminal duration on Runtime-owned facts', async () => {
    const root = await temporaryDirectory('repoctopus-runtime-telemetry-');
    cleanup.push(root);
    const store = new FileRuntimeStore(root);
    let second = 0;
    const runtime = new WorkflowRunCoordinator(
      store,
      { async export() {} },
      compositionFixture(),
      () => new Date(Date.UTC(2026, 10, 2, 0, 0, second++)),
      () => `event-${second}`,
    );
    const runId = 'runtime-telemetry';
    await runtime.start({
      workflow: workflowFixture(),
      projectSnapshot: projectFixture(),
      runId,
    });

    const first = await runtime.next(runId);
    await runtime.record({
      runId,
      actionId: first.value.state.pendingActionId!,
      status: 'succeeded',
      summary: 'inspection complete',
      eventId: 'inspection-complete',
    });
    const secondAction = await runtime.next(runId);
    const terminalInput = {
      runId,
      actionId: secondAction.value.state.pendingActionId!,
      status: 'succeeded' as const,
      summary: 'verification complete',
      eventId: 'verification-complete',
    };
    await runtime.record(terminalInput);
    await runtime.record(terminalInput);

    const trajectory = await store.loadTrajectory(runId);
    const started = trajectory.find((event) => event.type === 'run.started')!;
    const terminal = trajectory.filter(
      (event) => event.type === 'action.completed' && event.data.workflowRunResult === 'completed',
    );
    expect(started.data).toMatchObject({
      workflowName: 'test-flow',
      workflowVersion: '1.0.0',
      workflowRunResult: 'started',
    });
    expect(terminal).toHaveLength(1);
    expect(terminal[0]!.data).toMatchObject({
      workflowName: 'test-flow',
      workflowVersion: '1.0.0',
      workflowRunResult: 'completed',
      workflowRunDurationMs: Date.parse(terminal[0]!.timestamp) - Date.parse(started.timestamp),
    });
  });
});
