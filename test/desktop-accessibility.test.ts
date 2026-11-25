import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ObservationEnvelope } from '../domains/trajectory/observation.js';
import {
  createEmptyChangeProjection,
  reduceChangeProjection,
  type ChangeProjectionSnapshot,
} from '../domains/trajectory/projection.js';
import type { DesktopApplicationSnapshot } from '../services/desktop-application.js';

const dashboardModule = '../app/desktop/renderer/src/dashboard.js';

describe('desktop dashboard accessibility and resilient content', () => {
  it('renders named navigation, native controls, landmark structure and unabridged long facts', async () => {
    const { Dashboard } = (await import(dashboardModule)) as unknown as {
      Dashboard: ComponentType<{
        projection: ChangeProjectionSnapshot;
        application: DesktopApplicationSnapshot;
      }>;
    };
    const workspaceId = `workspace-${'w'.repeat(120)}`;
    const changeId = `change-${'c'.repeat(180)}`;
    const runId = `run-${'r'.repeat(180)}`;
    const observation: ObservationEnvelope = {
      schemaVersion: 1,
      envelopeId: `sha256:${'1'.repeat(64)}`,
      digest: `sha256:${'2'.repeat(64)}`,
      observedAt: '2026-10-29T00:00:00.000Z',
      eventType: 'work.host-started',
      identity: { eventId: 'event-accessibility', runId, sequence: 1 },
      correlation: {
        workspaceId,
        changeId,
        phase: 'build',
        buildAction: 'execute',
        workId: `work-${'x'.repeat(180)}`,
        attempt: Number.MAX_SAFE_INTEGER,
      },
      attributes: { result: 'running' },
    };
    const projection = reduceChangeProjection(createEmptyChangeProjection(), observation).snapshot;
    const application = {
      apiVersion: 'repoctopus.desktop/v1alpha1' as const,
      protocolVersion: 1 as const,
      phase: 'ready' as const,
      activeContext: null,
      selectedContext: { schemaVersion: 1 as const, workspaceId, changeId, runId },
    };

    const markup = renderToStaticMarkup(createElement(Dashboard, { projection, application }));
    expect(markup).toContain('<main');
    expect(markup).toContain('aria-label="活动 Run"');
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('aria-current="step"');
    expect(markup).toContain('执行工作包');
    expect(markup).toContain('<button');
    expect(markup).toContain(workspaceId);
    expect(markup).toContain(changeId);
    expect(markup).toContain(runId);
  });

  it('puts current approval guidance on the main screen and withdraws it as soon as Build starts', async () => {
    const { Dashboard } = (await import(dashboardModule)) as unknown as {
      Dashboard: ComponentType<{
        projection: ChangeProjectionSnapshot;
        application: DesktopApplicationSnapshot;
      }>;
    };
    const identity = { workspaceId: 'team', changeId: 'settings', runId: 'run-settings' };
    const application = {
      apiVersion: 'repoctopus.desktop/v1alpha1' as const,
      protocolVersion: 1 as const,
      phase: 'ready' as const,
      activeContext: null,
      selectedContext: { schemaVersion: 1 as const, ...identity },
    };
    const design: ObservationEnvelope = {
      schemaVersion: 1,
      envelopeId: `sha256:${'1'.repeat(64)}`,
      digest: `sha256:${'2'.repeat(64)}`,
      observedAt: '2026-10-29T00:00:00.000Z',
      eventType: 'change.lifecycle.transitioned',
      identity: { eventId: 'design', runId: identity.runId, sequence: 1 },
      correlation: {
        workspaceId: identity.workspaceId,
        changeId: identity.changeId,
        phase: 'design',
        decisionId: 'design-approval:settings',
        decisionKind: 'human-decision',
      },
      attributes: { toStatus: 'waiting', healthReason: 'design-approval' },
    };
    const waiting = reduceChangeProjection(createEmptyChangeProjection(), design).snapshot;
    const waitingMarkup = renderToStaticMarkup(
      createElement(Dashboard, { projection: waiting, application }),
    );
    expect(waitingMarkup).toContain('请审核设计方案');
    expect(waitingMarkup).toContain('复制给 Agent');
    expect(waitingMarkup).toContain('需要你决定');
    expect(waitingMarkup).toContain('data-tone="decision"');
    const build = reduceChangeProjection(waiting, {
      ...design,
      envelopeId: `sha256:${'3'.repeat(64)}`,
      identity: { eventId: 'approved', runId: identity.runId, sequence: 2 },
      correlation: {
        workspaceId: identity.workspaceId,
        changeId: identity.changeId,
        phase: 'build',
      },
      attributes: { fromPhase: 'design', toStatus: 'running' },
    }).snapshot;
    const buildMarkup = renderToStaticMarkup(
      createElement(Dashboard, { projection: build, application }),
    );
    expect(buildMarkup).toContain('实现进行中');
    expect(buildMarkup).not.toContain('复制给 Agent');
    expect(buildMarkup).not.toContain('data-tone="decision"');
  });

  it('keeps keyboard focus visible and supports narrow/high-DPI reflow without fixed zoom', async () => {
    const css = await readFile(
      path.resolve(import.meta.dirname, '../app/desktop/renderer/src/styles.css'),
      'utf8',
    );
    expect(css).toMatch(/button:focus-visible[\s\S]*outline:/u);
    expect(css).toContain('@media (max-width: 760px)');
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).not.toMatch(/zoom\s*:|transform\s*:\s*scale/u);
  });
});
