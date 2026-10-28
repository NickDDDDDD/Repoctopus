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
    expect(markup).toContain('<aside');
    expect(markup).toContain('aria-label="Workspace 与 change"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('<button');
    expect(markup).toContain('<summary>');
    expect(markup).toContain(workspaceId);
    expect(markup).toContain(changeId);
    expect(markup).toContain(runId);
    expect(markup).toContain(String(Number.MAX_SAFE_INTEGER));
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
