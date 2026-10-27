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

const attribute = (key: string, value: string | number | boolean) => ({
  key,
  value:
    typeof value === 'number'
      ? { intValue: String(value) }
      : typeof value === 'boolean'
        ? { boolValue: value }
        : { stringValue: value },
});

function record(
  eventName: string,
  eventAttributes: ReturnType<typeof attribute>[],
  sequence: number,
) {
  return {
    timeUnixNano: String(1_793_080_800_000_000_000n + BigInt(sequence)),
    body: { stringValue: eventName },
    attributes: eventAttributes,
  };
}

describe('Desktop Dashboard Evidence and decision projection', () => {
  it('renders allowlisted metadata and never projects restricted OTLP content', () => {
    const restricted = {
      body: 'PRIVATE-BODY',
      path: 'C:\\private\\artifact.log',
      prompt: 'PRIVATE-PROMPT',
      reply: 'PRIVATE-REPLY',
      command: 'PRIVATE-COMMAND',
    };
    const common = [
      attribute('repoctopus.change.id', 'change-evidence'),
      attribute('repoctopus.run.id', 'run-evidence'),
    ];
    const payload = {
      resourceLogs: [
        {
          resource: { attributes: [attribute('repoctopus.workspace.id', 'workspace-evidence')] },
          scopeLogs: [
            {
              logRecords: [
                record(
                  'evidence.artifact.recorded',
                  [
                    ...common,
                    attribute('repoctopus.evidence.event.id', 'artifact-event'),
                    attribute('repoctopus.evidence.event.sequence', 1),
                    attribute('repoctopus.evidence.attempt.id', 'attempt-5'),
                    attribute('repoctopus.evidence.artifact_digest', 'a'.repeat(64)),
                    attribute('repoctopus.evidence.artifact_type', 'test-log'),
                    attribute('repoctopus.evidence.artifact_size', 128),
                    attribute('repoctopus.evidence.media_type', 'text/plain'),
                    attribute('repoctopus.evidence.redacted', true),
                    ...Object.entries(restricted).map(([key, value]) =>
                      attribute(`repoctopus.evidence.${key}`, value),
                    ),
                  ],
                  1,
                ),
                record(
                  'evidence.gate.evaluated',
                  [
                    ...common,
                    attribute('repoctopus.evidence.event.id', 'gate-event'),
                    attribute('repoctopus.evidence.event.sequence', 2),
                    attribute('repoctopus.evidence.attempt.id', 'attempt-5'),
                    attribute('repoctopus.evidence.bundle_id', 'bundle-5'),
                    attribute('repoctopus.evidence.gate_status', 'satisfied'),
                    attribute('repoctopus.evidence.outcome', 'passed'),
                  ],
                  2,
                ),
                record(
                  'decision.requested',
                  [
                    ...common,
                    attribute('repoctopus.event.id', 'decision-event'),
                    attribute('repoctopus.event.sequence', 1),
                    attribute('repoctopus.decision.id', 'design-approval-5'),
                    attribute('repoctopus.decision.kind', 'design-approval'),
                    attribute('repoctopus.blocker.id', 'design-approval-5'),
                    attribute('repoctopus.blocker.kind', 'human-decision'),
                  ],
                  3,
                ),
                record(
                  'continuation.selected',
                  [
                    ...common,
                    attribute('repoctopus.event.id', 'continuation-event'),
                    attribute('repoctopus.event.sequence', 2),
                    attribute('repoctopus.next_action.kind', 'ask'),
                  ],
                  4,
                ),
              ],
            },
          ],
        },
      ],
    };
    const observations = decodeOtlpJsonProjectionObservations(Buffer.from(JSON.stringify(payload)));
    const projection = observations.reduce(
      (snapshot, observation) => reduceChangeProjection(snapshot, observation).snapshot,
      createEmptyChangeProjection(),
    );
    const reversedProjection = [...observations]
      .reverse()
      .reduce(
        (snapshot, observation) => reduceChangeProjection(snapshot, observation).snapshot,
        createEmptyChangeProjection(),
      );
    expect(reversedProjection).toEqual(projection);
    const shell: Extract<DesktopShellState, { phase: 'ready' }> = {
      phase: 'ready',
      snapshot: { apiVersion: DESKTOP_APPLICATION_CONTRACT, phase: 'ready' },
      projection,
      delta: null,
      launch: { sequence: 0, current: null, history: [] },
    };
    const model = dashboardModelFromShell(shell);
    const markup = renderToStaticMarkup(
      createElement(DashboardSurface, { model, onRetry: () => undefined }),
    );

    for (const value of [
      'attempt-5',
      'Gate satisfied · passed',
      'test-log',
      'text/plain · 128 bytes · redacted',
      'design-approval',
      'human-decision',
      'Next action',
      'ask',
    ]) {
      expect(markup).toContain(value);
    }
    for (const value of Object.values(restricted)) expect(markup).not.toContain(value);
    expect(model.state).toBe('waiting-human');
    expect(projection.freshness).toMatchObject({ status: 'fresh', headSequence: 2 });
  });
});
