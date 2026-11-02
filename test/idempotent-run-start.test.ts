import { afterEach, describe, expect, it } from 'vitest';

import { WorkflowRunCoordinator } from '../domains/runtime/workflow-runs.js';
import type { RunTriggerSnapshot } from '../domains/engine/types.js';
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

function trigger(sourceBranch = 'change/one'): RunTriggerSnapshot {
  return {
    schemaVersion: 1,
    kind: 'change.open',
    identityDigest: `sha256:${(sourceBranch === 'change/one' ? '1' : '2').repeat(64)}`,
    facts: {
      changeStartBinding: {
        schemaVersion: 1,
        workspaceRepositoryId: 'workspace',
        sourceRemoteIdentity: 'example.test/team/workspace',
        sourceBranch,
        targetRemoteIdentity: 'workspace',
        targetBranch: 'main',
        topologyIdentity: `sha256:${'3'.repeat(64)}`,
        digest: `sha256:${sourceBranch === 'change/one' ? '4'.repeat(64) : '5'.repeat(64)}`,
      },
    },
  };
}

async function fixture() {
  const root = await temporaryDirectory('repoctopus-idempotent-start-');
  cleanup.push(root);
  const store = new FileRuntimeStore(root);
  return {
    store,
    runtime: new WorkflowRunCoordinator(store, { async export() {} }, compositionFixture()),
  };
}

describe('idempotent Run start', () => {
  it('returns explicit started and resumed dispositions', async () => {
    const { runtime } = await fixture();
    const options = {
      workflow: workflowFixture(),
      projectSnapshot: projectFixture(),
      runId: 'change-team-one',
      trigger: trigger(),
    };
    const started = await runtime.startOrResume(options);
    const resumed = await runtime.startOrResume(options);
    expect(started.value).toMatchObject({ disposition: 'started' });
    expect(resumed.value).toMatchObject({ disposition: 'resumed' });
    expect(resumed.value.status.state.stateVersion).toBe(started.value.status.state.stateVersion);
  });

  it('serializes concurrent equivalent starts into one creation and one resume', async () => {
    const { runtime } = await fixture();
    const options = {
      workflow: workflowFixture(),
      projectSnapshot: projectFixture(),
      runId: 'change-team-concurrent',
      trigger: trigger(),
    };
    const results = await Promise.all([runtime.startOrResume(options), runtime.startOrResume(options)]);
    expect(results.map((result) => result.value.disposition).sort()).toEqual(['resumed', 'started']);
    expect(results[0].value.status.state.runId).toBe(results[1].value.status.state.runId);
  });

  it('returns a typed binding conflict without mutating the existing Run', async () => {
    const { runtime, store } = await fixture();
    const base = {
      workflow: workflowFixture(),
      projectSnapshot: projectFixture(),
      runId: 'change-team-conflict',
      trigger: trigger(),
    };
    await runtime.startOrResume(base);
    const before = await store.loadRun(base.runId);
    const trajectoryBefore = await store.loadTrajectory(base.runId);
    await expect(runtime.startOrResume({ ...base, trigger: trigger('change/two') })).rejects.toMatchObject(
      { code: 'runtime.workspace-binding-conflict' },
    );
    expect(await store.loadRun(base.runId)).toEqual(before);
    expect(await store.loadTrajectory(base.runId)).toEqual(trajectoryBefore);
  });
});
