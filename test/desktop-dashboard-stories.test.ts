import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DashboardSurface } from '../app/desktop/renderer/src/dashboard-surface.js';
import {
  DASHBOARD_STATE_STORIES,
  type DashboardSemanticState,
} from '../app/desktop/renderer/src/dashboard-stories.js';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const expectedStates: DashboardSemanticState[] = [
  'starting',
  'empty',
  'sparse',
  'live',
  'catching-up',
  'stale',
  'gap',
  'waiting-human',
  'blocked',
  'rework',
  'error',
  'completed',
  'failed',
];

function render(state: DashboardSemanticState): string {
  return renderToStaticMarkup(
    createElement(DashboardSurface, {
      model: DASHBOARD_STATE_STORIES[state],
      onRetry: () => undefined,
    }),
  );
}

describe('Desktop Dashboard semantic stories', () => {
  it('renders every reachable status through one semantic surface', () => {
    expect(Object.keys(DASHBOARD_STATE_STORIES)).toEqual(expectedStates);

    for (const state of expectedStates) {
      const markup = render(state);
      expect(markup).toContain(`data-dashboard-state="${state}"`);
      expect(markup).toContain('aria-label="Change lifecycle"');
      expect(markup.match(/data-phase-status=/g)).toHaveLength(5);
      expect(markup).toContain('data-region="current-context"');
      expect(markup).toContain('data-region="run-status"');
    }
  });

  it('exposes busy, recovery, and terminal states without relying on colour alone', () => {
    const starting = render('starting');
    expect(starting).toContain('aria-busy="true"');
    expect(starting).toContain('正在启动 Desktop Host');

    const error = render('error');
    expect(error).toContain('role="alert"');
    expect(error).toContain('重试 Desktop Host');

    const failed = render('failed');
    expect(failed).toContain('失败');
    expect(failed).toContain('data-phase-status="failed"');
  });

  it('defines reusable visual tokens instead of state-specific one-off values', async () => {
    const styles = await readFile(
      path.join(repositoryRoot, 'app', 'desktop', 'renderer', 'src', 'styles.css'),
      'utf8',
    );
    for (const token of [
      '--space-1',
      '--space-2',
      '--space-3',
      '--radius-control',
      '--radius-panel',
      '--status-info',
      '--status-success',
      '--status-warning',
      '--status-danger',
    ]) {
      expect(styles).toContain(token);
    }
  });
});
