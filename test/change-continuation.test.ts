import { describe, expect, it } from 'vitest';

import { projectLifecycleNextActions } from '../domains/change-lifecycle/continuation.js';
import type { ChangeLifecycleSnapshot } from '../domains/change-lifecycle/transition.js';

function snapshot(patch: Partial<ChangeLifecycleSnapshot>): ChangeLifecycleSnapshot {
  return {
    schemaVersion: 2,
    identity: { runId: 'run', workspaceId: 'workspace', changeId: 'change' },
    definition: {
      id: 'builtin.change-lifecycle',
      version: '1',
      digest: `sha256:${'a'.repeat(64)}`,
    },
    revision: 3,
    checkEpoch: 2,
    phase: 'build',
    status: 'running',
    currentWork: null,
    waitCondition: null,
    blocker: null,
    ...patch,
  };
}

describe('committed lifecycle continuation projector', () => {
  it('derives one deterministic Work continuation from the committed checkpoint', () => {
    const current = snapshot({
      currentWork: {
        workId: 'build.plan:abc',
        schemaVersion: 2,
        checkEpoch: 2,
        phase: 'build',
        kind: 'build.plan',
      } as ChangeLifecycleSnapshot['currentWork'],
    });
    expect(projectLifecycleNextActions(current)).toEqual([
      { id: 'build.plan:abc', kind: 'work', label: 'Run build.plan' },
    ]);
    expect(projectLifecycleNextActions(structuredClone(current))).toEqual(
      projectLifecycleNextActions(current),
    );
  });

  it('does not infer runnable work for completed or blocked checkpoints', () => {
    expect(
      projectLifecycleNextActions(snapshot({ phase: 'archive', status: 'completed' })),
    ).toEqual([]);
    expect(projectLifecycleNextActions(snapshot({ phase: 'build', status: 'blocked' }))).toEqual([
      { id: 'build.blocked', kind: 'wait', label: 'Resolve Build blocker' },
    ]);
  });
});
