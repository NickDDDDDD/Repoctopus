import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { decodeOtlpJsonProjectionObservations } from '../app/desktop/host/otlp-json-projection.js';
import { dashboardModelFromShell } from '../app/desktop/renderer/src/dashboard-model.js';
import { DashboardSurface } from '../app/desktop/renderer/src/dashboard-surface.js';
import type { DesktopShellState } from '../app/desktop/shared/renderer-contract.js';
import {
  createEmptyChangeProjection,
  reduceChangeProjection,
} from '../domains/telemetry/change-projection.js';
import { DESKTOP_APPLICATION_CONTRACT } from '../services/desktop-application.js';

const attribute = (key: string, value: string | number) => ({
  key,
  value: typeof value === 'number' ? { intValue: String(value) } : { stringValue: value },
});

function skillRecord(
  sequence: number,
  eventName: 'skill.resolved' | 'skill.delivered' | 'skill.consumed',
  name: string,
  role: 'action' | 'augmentation',
) {
  return {
    timeUnixNano: String(1_793_080_800_000_000_000n + BigInt(sequence)),
    body: { stringValue: eventName },
    attributes: [
      attribute('repoctopus.event.id', `skill-${sequence}`),
      attribute('repoctopus.event.sequence', sequence),
      attribute('repoctopus.change.id', 'change-skills'),
      attribute('repoctopus.run.id', 'run-skills'),
      attribute('repoctopus.workflow.name', 'repoctopus-change'),
      attribute('repoctopus.execution.phase', 'build'),
      attribute('repoctopus.execution.work.id', 'build:5.4'),
      attribute('repoctopus.execution.work.kind', 'task.implement'),
      attribute('repoctopus.execution.attempt', 1),
      attribute('repoctopus.skill.name', name),
      attribute('repoctopus.skill.role', role),
      ...(eventName === 'skill.consumed'
        ? [attribute('repoctopus.execution.result', 'accepted')]
        : []),
    ],
  };
}

function modelFor(records: readonly ReturnType<typeof skillRecord>[]) {
  const body = Buffer.from(
    JSON.stringify({
      resourceLogs: [
        {
          resource: { attributes: [attribute('repoctopus.workspace.id', 'workspace-skills')] },
          scopeLogs: [{ logRecords: records }],
        },
      ],
    }),
  );
  const projection = decodeOtlpJsonProjectionObservations(body).reduce(
    (snapshot, observation) => reduceChangeProjection(snapshot, observation).snapshot,
    createEmptyChangeProjection(),
  );
  const shell: Extract<DesktopShellState, { phase: 'ready' }> = {
    phase: 'ready',
    snapshot: { apiVersion: DESKTOP_APPLICATION_CONTRACT, phase: 'ready' },
    projection,
    delta: null,
    launch: { sequence: 0, current: null, history: [] },
  };
  return dashboardModelFromShell(shell);
}

describe('Desktop Dashboard Skill semantics', () => {
  it('keeps delivered distinct from consumed until the accepted consumption event arrives', () => {
    const delivered = modelFor([
      skillRecord(1, 'skill.resolved', 'repoctopus-build-task', 'action'),
      skillRecord(2, 'skill.delivered', 'repoctopus-build-task', 'action'),
    ]);
    expect(delivered.currentWork?.skills).toEqual([
      expect.objectContaining({
        name: 'repoctopus-build-task',
        role: 'action',
        status: 'delivered',
      }),
    ]);

    const consumed = modelFor([
      skillRecord(1, 'skill.resolved', 'repoctopus-build-task', 'action'),
      skillRecord(2, 'skill.delivered', 'repoctopus-build-task', 'action'),
      skillRecord(3, 'skill.consumed', 'repoctopus-build-task', 'action'),
    ]);
    expect(consumed.currentWork?.skills[0]?.status).toBe('consumed');
  });

  it('renders both roles, all three states and a custom Skill without an internal-thought claim', () => {
    const model = modelFor([
      skillRecord(1, 'skill.consumed', 'repoctopus-build-task', 'action'),
      skillRecord(2, 'skill.delivered', 'tdd', 'augmentation'),
      skillRecord(3, 'skill.resolved', 'team-custom-review', 'augmentation'),
    ]);
    const markup = renderToStaticMarkup(
      createElement(DashboardSurface, { model, onRetry: () => undefined }),
    );

    for (const value of [
      'repoctopus-build-task',
      'tdd',
      'team-custom-review',
      'Action',
      'Augmentation',
      'Resolved',
      'Delivered',
      'Consumed',
      'Host 声明并经 Runtime 验证',
      '不观察 Agent 的内部思考',
    ]) {
      expect(markup).toContain(value);
    }
  });
});
