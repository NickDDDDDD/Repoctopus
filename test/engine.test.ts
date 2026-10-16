import { describe, expect, it } from 'vitest';

import { decide, recordOutcome, startRun } from '../domains/engine/loop.js';
import { workflowFixture } from './helpers/fixtures.js';

const timestamp = '2026-01-01T00:00:00.000Z';

describe('deterministic engine', () => {
  it('proposes stable actions and reaches completion', () => {
    const workflow = workflowFixture();
    const initial = startRun({
      workflow,
      runId: 'run-engine-1',
      projectSnapshotDigest: 'project-digest',
      timestamp,
      traceId: '0'.repeat(32),
    });
    const first = decide(workflow, initial, timestamp);
    const repeated = decide(workflow, initial, timestamp);
    expect(first.action).toEqual(repeated.action);
    expect(first.state.stateVersion).toBe(1);
    const afterFirst = recordOutcome(
      workflow,
      first.state,
      { eventId: 'event-1', actionId: first.action!.id, status: 'succeeded', summary: 'done' },
      timestamp,
    );
    const second = decide(workflow, afterFirst, timestamp);
    const completed = recordOutcome(
      workflow,
      second.state,
      { eventId: 'event-2', actionId: second.action!.id, status: 'succeeded', summary: 'done' },
      timestamp,
    );
    expect(completed.status).toBe('completed');
    expect(completed.currentStep).toBeNull();
  });

  it('enforces retry budgets, confirmations and reconciliation', () => {
    const workflow = workflowFixture();
    workflow.definition.guardrails.confirmationRequiredFor = ['inspected'];
    const state = startRun({
      workflow,
      runId: 'run-engine-2',
      projectSnapshotDigest: 'project-digest',
      timestamp,
    });
    expect(decide(workflow, state, timestamp).reason).toMatch(/confirmation/i);
    const allowed = decide(workflow, state, timestamp, new Set(['inspected']));
    expect(allowed.action?.ref).toBe('inspected');
    const blocked = decide(workflow, { ...state, reconciliationRequired: true }, timestamp);
    expect(blocked.action).toBeNull();
    expect(blocked.reason).toMatch(/reconciliation/i);
  });

  it('rejects an outcome for any action other than the pending action', () => {
    const workflow = workflowFixture();
    const state = startRun({
      workflow,
      runId: 'run-engine-3',
      projectSnapshotDigest: 'project-digest',
      timestamp,
    });
    expect(() =>
      recordOutcome(
        workflow,
        state,
        { eventId: 'event-3', actionId: 'wrong-action', status: 'succeeded', summary: 'bad' },
        timestamp,
      ),
    ).toThrow(/does not match pending action/i);
  });
});
