import { afterEach, describe, expect, it } from 'vitest';

import { RepoctopusRuntime } from '../domains/runtime/runtime.js';
import type { EvidenceGatePort, TelemetryBatch, TelemetryPort } from '../domains/runtime/types.js';
import { createWorkflowPackage } from '../domains/workflow-contract/package.js';
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
  function evidenceWorkflow() {
    const definition = structuredClone(workflowFixture().definition);
    definition.steps[1]!.action.evidenceProfile = 'verify';
    return createWorkflowPackage(definition);
  }

  async function waitingAtEvidence(runtime: RepoctopusRuntime, runId: string) {
    await runtime.start({
      workflow: evidenceWorkflow(),
      projectSnapshot: projectFixture(),
      runId,
    });
    const inspect = await runtime.next(runId);
    await runtime.record({
      runId,
      actionId: inspect.value.state.pendingActionId!,
      status: 'succeeded',
      summary: 'inspection complete',
    });
    return runtime.next(runId);
  }

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

  it('rejects a manually reported success for an evidence-protected step', async () => {
    const workspace = await temporaryDirectory('repoctopus-runtime-evidence-required-');
    cleanup.push(workspace);
    const runtime = new RepoctopusRuntime(new FileRuntimeStore(workspace), {
      async export() {},
    });
    const waiting = await waitingAtEvidence(runtime, 'run-evidence-required');
    await expect(
      runtime.record({
        runId: 'run-evidence-required',
        actionId: waiting.value.state.pendingActionId!,
        status: 'succeeded',
        summary: 'manual success',
      }),
    ).rejects.toThrow(/Runtime evidence attempt/i);
    expect((await runtime.status('run-evidence-required')).state.status).toBe('waiting');
  });

  it('re-evaluates a bound Evidence Gate and records it in the transition', async () => {
    const workspace = await temporaryDirectory('repoctopus-runtime-evidence-gate-');
    cleanup.push(workspace);
    const evaluations: Parameters<EvidenceGatePort['evaluate']>[0][] = [];
    const gate: EvidenceGatePort = {
      evaluate(input) {
        evaluations.push(input);
        return Promise.resolve({
          schemaVersion: 1,
          kind: 'EvidenceGateProjection',
          workflowRunId: input.workflowRunId,
          workflowActionId: input.workflowActionId,
          workflowStepId: input.workflowStepId,
          workflowStateVersion: input.workflowStateVersion,
          profileId: input.profileId,
          bundleId: 'bundle-verified',
          inputFingerprint: 'fingerprint-current',
          outcome: 'passed',
          status: 'satisfied',
          reason: 'current Runtime evidence passed',
        });
      },
    };
    const runtime = new RepoctopusRuntime(
      new FileRuntimeStore(workspace),
      { async export() {} },
      undefined,
      undefined,
      undefined,
      gate,
    );
    const waiting = await waitingAtEvidence(runtime, 'run-evidence-gate');
    const completed = await runtime.record({
      runId: 'run-evidence-gate',
      actionId: waiting.value.state.pendingActionId!,
      status: 'succeeded',
      summary: 'verified by Runtime',
      evidenceAttemptId: 'attempt-verified',
    });
    expect(completed.value.state.status).toBe('completed');
    expect(evaluations).toEqual([
      expect.objectContaining({
        attemptId: 'attempt-verified',
        workflowRunId: 'run-evidence-gate',
        workflowActionId: waiting.value.state.pendingActionId,
        workflowStepId: waiting.value.state.currentStep,
        workflowStateVersion: waiting.value.state.stateVersion,
        profileId: 'verify',
      }),
    ]);
    const store = new FileRuntimeStore(workspace);
    const trajectory = await store.loadTrajectory('run-evidence-gate');
    expect(trajectory.at(-1)?.data).toMatchObject({
      evidenceAttemptId: 'attempt-verified',
      evidenceGate: {
        workflowRunId: 'run-evidence-gate',
        bundleId: 'bundle-verified',
        status: 'satisfied',
      },
    });
    expect(completed.value.state.acceptedEvidenceBundleIds).toEqual(['bundle-verified']);
    expect((await store.loadCheckpoint('run-evidence-gate')).acceptedEvidenceBundleIds).toEqual([
      'bundle-verified',
    ]);
  });

  it('keeps the protected step waiting when the Evidence Gate is blocked', async () => {
    const workspace = await temporaryDirectory('repoctopus-runtime-evidence-blocked-');
    cleanup.push(workspace);
    const gate: EvidenceGatePort = {
      evaluate(input) {
        return Promise.resolve({
          schemaVersion: 1,
          kind: 'EvidenceGateProjection',
          workflowRunId: input.workflowRunId,
          workflowActionId: input.workflowActionId,
          workflowStepId: input.workflowStepId,
          workflowStateVersion: input.workflowStateVersion,
          profileId: input.profileId,
          bundleId: 'bundle-stale',
          inputFingerprint: 'fingerprint-stale',
          outcome: 'incomplete',
          status: 'blocked',
          reason: 'inputs changed after verification',
        });
      },
    };
    const runtime = new RepoctopusRuntime(
      new FileRuntimeStore(workspace),
      { async export() {} },
      undefined,
      undefined,
      undefined,
      gate,
    );
    const waiting = await waitingAtEvidence(runtime, 'run-evidence-blocked');
    await expect(
      runtime.record({
        runId: 'run-evidence-blocked',
        actionId: waiting.value.state.pendingActionId!,
        status: 'succeeded',
        summary: 'stale evidence',
        evidenceAttemptId: 'attempt-stale',
      }),
    ).rejects.toThrow(/inputs changed after verification/i);
    expect((await runtime.status('run-evidence-blocked')).state.status).toBe('waiting');
  });
});
