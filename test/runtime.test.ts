import { afterEach, describe, expect, it } from 'vitest';

import { RepoctopusRuntime } from '../domains/runtime/runtime.js';
import type { TelemetryBatch, TelemetryPort } from '../domains/runtime/types.js';
import { FileRuntimeStore } from '../platform/runtime/file-runtime-store.js';
import {
  projectFixture,
  removeTemporaryDirectory,
  temporaryDirectory,
  workflowFixture,
} from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

class FlakyTelemetry implements TelemetryPort {
  attempts = 0;
  batches: TelemetryBatch[] = [];

  export(batch: TelemetryBatch): Promise<void> {
    this.attempts += 1;
    if (this.attempts === 1) return Promise.reject(new Error('collector unavailable'));
    this.batches.push(structuredClone(batch));
    return Promise.resolve();
  }
}

describe('Repoctopus runtime', () => {
  it('isolates runs started from the same project snapshot', async () => {
    const workspace = await temporaryDirectory('repoctopus-run-isolation-');
    cleanup.push(workspace);
    const runtime = new RepoctopusRuntime(new FileRuntimeStore(workspace), {
      async export() {},
    });
    const projectSnapshot = projectFixture();
    const workflow = workflowFixture();
    await runtime.start({ workflow, projectSnapshot, runId: 'run-isolated-a' });
    await runtime.start({ workflow, projectSnapshot, runId: 'run-isolated-b' });
    const first = await runtime.next('run-isolated-a');
    const second = await runtime.status('run-isolated-b');
    expect(first.value.state.pendingActionId).not.toBeNull();
    expect(second.state.pendingActionId).toBeNull();
    await expect(
      runtime.record({
        runId: 'run-isolated-b',
        actionId: first.value.state.pendingActionId!,
        status: 'succeeded',
        summary: 'wrong run',
      }),
    ).rejects.toThrow(/does not match pending action/i);
  });

  it('serializes concurrent writers and rejects the stale transition', async () => {
    const workspace = await temporaryDirectory('repoctopus-concurrent-writers-');
    cleanup.push(workspace);
    const runtime = new RepoctopusRuntime(new FileRuntimeStore(workspace), {
      async export() {},
    });
    await runtime.start({
      workflow: workflowFixture(),
      projectSnapshot: projectFixture(),
      runId: 'run-concurrent-writers',
    });
    const proposed = await runtime.next('run-concurrent-writers');
    const actionId = proposed.value.state.pendingActionId!;
    const results = await Promise.allSettled([
      runtime.record({
        runId: 'run-concurrent-writers',
        actionId,
        status: 'succeeded',
        summary: 'writer one',
        eventId: 'event-writer-one',
      }),
      runtime.record({
        runId: 'run-concurrent-writers',
        actionId,
        status: 'succeeded',
        summary: 'writer two',
        eventId: 'event-writer-two',
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await runtime.status('run-concurrent-writers')).trajectoryLength).toBe(3);
  });

  it('allows only one concurrent initializer for the same run identity', async () => {
    const workspace = await temporaryDirectory('repoctopus-concurrent-start-');
    cleanup.push(workspace);
    const runtime = new RepoctopusRuntime(new FileRuntimeStore(workspace), {
      async export() {},
    });
    const options = {
      workflow: workflowFixture(),
      projectSnapshot: projectFixture(),
      runId: 'run-concurrent-start',
    };
    const results = await Promise.allSettled([runtime.start(options), runtime.start(options)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await runtime.status(options.runId)).trajectoryLength).toBe(1);
  });

  it('replays telemetry backlog and records outcomes idempotently', async () => {
    const workspace = await temporaryDirectory('repoctopus-runtime-');
    cleanup.push(workspace);
    const telemetry = new FlakyTelemetry();
    let tick = 0;
    const runtime = new RepoctopusRuntime(
      new FileRuntimeStore(workspace),
      telemetry,
      () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
      () => `uuid-${tick}`,
    );
    const started = await runtime.start({
      workflow: workflowFixture(),
      projectSnapshot: projectFixture(),
      runId: 'run-runtime-1',
    });
    expect(started.diagnostics[0]?.code).toBe('telemetry.export-failed');
    const resumedRuntime = new RepoctopusRuntime(
      new FileRuntimeStore(workspace),
      telemetry,
      () => new Date(Date.UTC(2026, 0, 1, 0, 1, tick++)),
      () => `resumed-${tick}`,
    );
    const proposed = await resumedRuntime.next('run-runtime-1');
    expect(telemetry.batches[0]?.events.map((event) => event.type)).toEqual([
      'run.started',
      'action.proposed',
    ]);
    const actionId = proposed.value.state.pendingActionId!;
    const recorded = await resumedRuntime.record({
      runId: 'run-runtime-1',
      actionId,
      status: 'succeeded',
      summary: 'verified',
      eventId: 'event-runtime-1',
    });
    const replay = await resumedRuntime.record({
      runId: 'run-runtime-1',
      actionId,
      status: 'succeeded',
      summary: 'ignored duplicate payload',
      eventId: 'event-runtime-1',
    });
    expect(recorded.value.trajectoryLength).toBe(3);
    expect(replay.value.trajectoryLength).toBe(3);
    expect(replay.diagnostics[0]?.code).toBe('runtime.idempotent-replay');
  });

  it('blocks new decisions when repositories changed after a checkpoint', async () => {
    const workspace = await temporaryDirectory('repoctopus-reconcile-');
    cleanup.push(workspace);
    const runtime = new RepoctopusRuntime(
      new FileRuntimeStore(workspace),
      { async export() {} },
      () => new Date('2026-01-01T00:00:00.000Z'),
      () => 'resume-event',
    );
    const previous = projectFixture();
    await runtime.start({
      workflow: workflowFixture(),
      projectSnapshot: previous,
      runId: 'run-reconcile',
    });
    const current = projectFixture({ root: 'C:/different-project' });
    const resumed = await runtime.resume({
      runId: 'run-reconcile',
      currentProjectSnapshot: current,
    });
    expect(resumed.value.reconciliation.changed).toBe(true);
    expect(resumed.value.state.reconciliationRequired).toBe(true);
    expect(resumed.value.nextAction).toBeNull();
    const blocked = await runtime.next('run-reconcile');
    expect(blocked.value.nextAction).toBeNull();
    expect(blocked.diagnostics[0]?.message).toMatch(/reconciliation/i);
  });

  it('keeps the frozen workflow and reports source drift', async () => {
    const workspace = await temporaryDirectory('repoctopus-workflow-drift-');
    cleanup.push(workspace);
    const original = workflowFixture();
    const changed = workflowFixture();
    changed.definition.metadata.version = '2.0.0';
    changed.digest = 'changed-workflow-digest';
    const runtime = new RepoctopusRuntime(
      new FileRuntimeStore(workspace),
      { async export() {} },
      () => new Date('2026-01-01T00:00:00.000Z'),
      () => 'unused',
      { load: () => Promise.resolve(changed) },
    );
    await runtime.start({
      workflow: original,
      workflowSource: 'workflows/project.yaml',
      projectSnapshot: projectFixture(),
      runId: 'run-workflow-drift',
    });
    const status = await runtime.status('run-workflow-drift');
    expect(status.state.workflowDigest).toBe(original.digest);
    expect(status.workflowDrift).toMatchObject({
      checked: true,
      changed: true,
      expectedDigest: original.digest,
      currentDigest: changed.digest,
    });
  });
});
