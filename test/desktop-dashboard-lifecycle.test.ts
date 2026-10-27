import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { dashboardModelFromShell } from '../app/desktop/renderer/src/dashboard-model.js';
import { DashboardSurface } from '../app/desktop/renderer/src/dashboard-surface.js';
import type { DesktopShellState } from '../app/desktop/shared/renderer-contract.js';
import {
  createEmptyChangeProjection,
  reduceChangeProjection,
  type ChangeProjectionObservation,
} from '../domains/telemetry/change-projection.js';
import { DESKTOP_APPLICATION_CONTRACT } from '../services/desktop-application.js';

type RichObservation = ChangeProjectionObservation & {
  task: { id: string; revision: string | null } | null;
  host: { id: string; status: 'running' | 'completed' | 'failed' } | null;
  validator: { id: string; status: 'running' | 'completed' | 'failed' } | null;
  continuation: 'execute' | 'ask' | 'wait' | 'reconcile' | 'done' | null;
  recoverySourcePhase: 'open' | 'design' | 'build' | 'verify' | 'archive' | null;
};

function event(
  sequence: number,
  eventName: string,
  phase: RichObservation['phase'],
  overrides: Partial<RichObservation> = {},
): RichObservation {
  return {
    schemaVersion: 1,
    sequence,
    eventId: `event-${sequence}`,
    eventName,
    observedAt: `2026-10-27T09:${String(sequence).padStart(2, '0')}:00.000Z`,
    workspaceId: 'workspace-a',
    changeId: 'change-a',
    runId: 'run-a',
    workflowName: 'repoctopus-change',
    phase,
    work: null,
    skill: null,
    task: null,
    host: null,
    validator: null,
    continuation: null,
    recoverySourcePhase: null,
    previousPhase: null,
    lifecycleStatus: null,
    result: null,
    ...overrides,
  };
}

function shell(
  records: readonly RichObservation[],
): Extract<DesktopShellState, { phase: 'ready' }> {
  const projection = records.reduce(
    (snapshot, record) => reduceChangeProjection(snapshot, record).snapshot,
    createEmptyChangeProjection(),
  );
  return {
    phase: 'ready',
    snapshot: { apiVersion: DESKTOP_APPLICATION_CONTRACT, phase: 'ready' },
    projection,
    delta: null,
    launch: { sequence: 0, current: null, history: [] },
  };
}

function phaseRecords(until: 'build' | 'verify' | 'archive'): RichObservation[] {
  const phases = ['open', 'design', 'build', 'verify', 'archive'] as const;
  const result: RichObservation[] = [];
  let sequence = 1;
  for (const phase of phases) {
    result.push(event(sequence++, 'change.phase.entered', phase));
    if (phase === until) break;
    result.push(event(sequence++, 'change.phase.completed', phase, { result: 'succeeded' }));
  }
  return result;
}

function currentExecutionRecords(startSequence: number): RichObservation[] {
  const work = { id: 'build:5.3', kind: 'task.implement', attempt: 2 };
  return [
    event(startSequence, 'work.created', 'build', {
      work,
      task: { id: '5.3', revision: `sha256:${'a'.repeat(64)}` },
    }),
    event(startSequence + 1, 'work.host-started', 'build', {
      work,
      task: { id: '5.3', revision: `sha256:${'a'.repeat(64)}` },
      host: { id: 'external:cli:codex-root', status: 'running' },
    }),
    event(startSequence + 2, 'validator.started', 'build', {
      work,
      task: { id: '5.3', revision: `sha256:${'a'.repeat(64)}` },
      validator: { id: 'build.task-valid', status: 'running' },
    }),
    event(startSequence + 3, 'continuation.selected', 'build', {
      work,
      task: { id: '5.3', revision: `sha256:${'a'.repeat(64)}` },
      continuation: 'execute',
    }),
  ];
}

describe('Desktop Dashboard five-stage lifecycle projection', () => {
  it('converges authoritative lifecycle transitions and preserves a fallback source', () => {
    const observations = [
      event(1, 'change.phase.entered', 'open', {
        previousPhase: 'open',
        lifecycleStatus: 'running',
      }),
      event(2, 'change.phase.entered', 'design', {
        previousPhase: 'open',
        lifecycleStatus: 'running',
      }),
      event(3, 'change.phase.entered', 'build', {
        previousPhase: 'design',
        lifecycleStatus: 'running',
      }),
      event(4, 'change.phase.entered', 'verify', {
        previousPhase: 'build',
        lifecycleStatus: 'running',
      }),
      event(5, 'change.phase.reopened', 'build', {
        previousPhase: 'verify',
        recoverySourcePhase: 'verify',
        lifecycleStatus: 'running',
      }),
    ];

    const ordered = shell(observations).projection;
    expect(shell([...observations].reverse()).projection).toEqual(ordered);
    const model = dashboardModelFromShell(shell(observations));
    expect(model.state).toBe('rework');
    expect(model.phases.find((phase) => phase.phase === 'build')?.status).toBe('rework');
    expect(model.phases.find((phase) => phase.phase === 'verify')?.status).toBe('blocked');
  });

  it('shows current Task, attempt, Host, Validator and Runtime continuation', () => {
    const records = phaseRecords('build');
    const observations = [...records, ...currentExecutionRecords(records.length + 1)];
    const state = shell(observations);
    expect(shell([...observations].reverse()).projection).toEqual(state.projection);
    const model = dashboardModelFromShell(state);

    expect(model).toMatchObject({
      state: 'live',
      currentWork: {
        id: 'build:5.3',
        attempt: 2,
        task: { id: '5.3' },
        host: { id: 'external:cli:codex-root', status: 'running' },
        validator: { id: 'build.task-valid', status: 'running' },
        continuation: 'execute',
      },
    });
    const markup = renderToStaticMarkup(
      createElement(DashboardSurface, { model, onRetry: () => undefined }),
    );
    for (const value of ['Task 5.3', 'Attempt 2', 'external:cli:codex-root', 'build.task-valid']) {
      expect(markup).toContain(value);
    }
  });

  it.each([
    ['Verify → Build', 'verify', 'build'],
    ['Archive → Verify', 'archive', 'verify'],
    ['Archive → Design', 'archive', 'design'],
  ] as const)('preserves prior attempts for %s rework', (_label, source, target) => {
    const records = phaseRecords(source);
    let sequence = records.length + 1;
    const firstWork = { id: `${target}:work`, kind: 'task.implement', attempt: 1 };
    records.push(
      event(sequence++, 'work.created', target, { work: firstWork }),
      event(sequence++, 'work.completed', target, { work: firstWork, result: 'succeeded' }),
      event(sequence++, 'change.phase.reopened', target, {
        recoverySourcePhase: source,
        result: 'reopened',
      }),
      event(sequence, 'work.created', target, {
        work: { ...firstWork, attempt: 2 },
      }),
    );

    const model = dashboardModelFromShell(shell(records));
    expect(model.state).toBe('rework');
    const targetPhase = model.phases.find((phase) => phase.phase === target);
    expect(targetPhase?.status).toBe('rework');
    expect(targetPhase?.history.some((entry) => entry.event === 'entered')).toBe(true);
    expect(
      targetPhase?.history.some(
        (entry) => entry.event === 'reopened' && entry.recoverySourcePhase === source,
      ),
    ).toBe(true);
    expect(
      model.executionHistory.some(
        (work) => work.phase === target && work.attempt === 1 && work.status === 'completed',
      ),
    ).toBe(true);
    expect(
      model.executionHistory.some(
        (work) => work.phase === target && work.attempt === 2 && work.status === 'active',
      ),
    ).toBe(true);
  });
});
