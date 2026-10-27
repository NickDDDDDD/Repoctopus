import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DashboardSurface } from '../app/desktop/renderer/src/dashboard-surface.js';
import { DASHBOARD_STATE_STORIES } from '../app/desktop/renderer/src/dashboard-stories.js';

const repositoryRoot = path.resolve(import.meta.dirname, '..');

describe('Desktop Dashboard resilient and accessible layout', () => {
  it('retains accessible names for long identities and exact large health values', () => {
    const longWorkspace = `workspace-${'platform-'.repeat(24)}`;
    const longChange = `change-${'observability-'.repeat(22)}`;
    const large = Number.MAX_SAFE_INTEGER;
    const model = {
      ...DASHBOARD_STATE_STORIES.live,
      workspaceId: longWorkspace,
      changeId: longChange,
      destinations: [
        {
          id: `destination-${'remote-'.repeat(24)}`,
          kind: 'remote' as const,
          result: 'failed',
          cursorLag: large,
          backlogCount: large,
          backlogBytes: large,
          backlogOldestAgeMs: large,
          retryCount: large,
          gapCount: large,
          completeHistory: false,
          receiverResult: null,
          observedAt: '2026-10-27T11:00:00.000Z',
        },
      ],
    };
    const markup = renderToStaticMarkup(
      createElement(DashboardSurface, {
        model,
        navigation: {
          groups: [
            {
              workspaceId: longWorkspace,
              changes: [
                {
                  workspaceId: longWorkspace,
                  changeId: longChange,
                  runId: 'run-long-layout',
                  status: 'active',
                  selected: true,
                },
              ],
            },
          ],
        },
        onSelect: () => undefined,
        onRetry: () => undefined,
      }),
    );

    expect(markup).toContain(longWorkspace);
    expect(markup).toContain(longChange);
    expect(markup).toContain(`Backlog ${large}`);
    expect(markup).toContain(`Cursor lag ${large}`);
    expect(markup).toContain('aria-label="Change lifecycle"');
    expect(markup).toContain('aria-label="当前上下文"');
    expect(markup).toContain('aria-labelledby="health-title"');
    expect(markup).toContain('type="button"');
  });

  it('gives every keyboard control a visible focus treatment and bounds dense numbers', async () => {
    const styles = await readFile(
      path.join(repositoryRoot, 'app', 'desktop', 'renderer', 'src', 'styles.css'),
      'utf8',
    );

    expect(styles).toMatch(/button:focus-visible\s*,\s*summary:focus-visible/u);
    expect(styles).toMatch(/\.telemetry-health dd\s*\{[^}]*overflow:\s*hidden/isu);
    expect(styles).toMatch(/@container \(max-width: 540px\)/u);
    expect(styles).toContain('min-width: 320px');
  });
});
