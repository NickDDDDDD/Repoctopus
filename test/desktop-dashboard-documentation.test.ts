import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DashboardSurface } from '../app/desktop/renderer/src/dashboard-surface.js';
import { classifyDashboardDataState } from '../app/desktop/renderer/src/dashboard-model.js';
import {
  DASHBOARD_STATE_STORIES,
  type DashboardSemanticState,
} from '../app/desktop/renderer/src/dashboard-stories.js';

interface DocumentationFixture {
  dataStates: readonly {
    id: string;
    story: DashboardSemanticState;
    label: string;
    marker: string;
    freshness: 'fresh' | 'gap';
    desktopBacklogCount: number;
    currentPhase: 'open' | 'design' | 'build' | 'verify' | 'archive' | null;
    lastObservedAgeMs: number;
  }[];
  skillStates: readonly { id: string; label: string }[];
  healthKinds: readonly { id: string; label: string; target: string }[];
}

const repositoryRoot = path.resolve(import.meta.dirname, '..');

function containsTableCell(documentation: string, value: string): void {
  expect(documentation).toMatch(new RegExp(`\\|\\s*${value}\\s*\\|`, 'u'));
}

async function fixture(): Promise<DocumentationFixture> {
  return JSON.parse(
    await readFile(
      path.join(
        repositoryRoot,
        'test',
        'fixtures',
        'desktop-dashboard',
        'documentation-semantics.json',
      ),
      'utf8',
    ),
  ) as DocumentationFixture;
}

describe('Desktop Dashboard public semantics', () => {
  it('documents and renders live, catching-up, stale, unknown and gap as distinct states', async () => {
    const semantics = await fixture();
    const documentation = await readFile(
      path.join(repositoryRoot, 'docs', 'desktop-dashboard.md'),
      'utf8',
    );

    expect(semantics.dataStates.map((state) => state.id)).toEqual([
      'live',
      'catching-up',
      'stale',
      'unknown',
      'gap',
    ]);
    for (const state of semantics.dataStates) {
      const nowMs = Date.parse('2026-10-27T10:10:00.000Z');
      expect(
        classifyDashboardDataState({
          freshnessStatus: state.freshness,
          desktopBacklogCount: state.desktopBacklogCount,
          currentPhase: state.currentPhase,
          lastObservedAt: new Date(nowMs - state.lastObservedAgeMs).toISOString(),
          nowMs,
        }),
      ).toBe(state.id);
      expect(documentation).toContain(`<!-- ${state.marker} -->`);
      expect(documentation).toContain(`| ${state.label} |`);
      const markup = renderToStaticMarkup(
        createElement(DashboardSurface, {
          model: DASHBOARD_STATE_STORIES[state.story],
          onRetry: () => undefined,
        }),
      );
      expect(markup).toContain(state.label);
    }
  });

  it('defines Skill consumption and four health dimensions without overstating evidence', async () => {
    const semantics = await fixture();
    const documentation = await readFile(
      path.join(repositoryRoot, 'docs', 'desktop-dashboard.md'),
      'utf8',
    );

    for (const skill of semantics.skillStates) {
      containsTableCell(documentation, skill.label);
    }
    expect(documentation).toContain('Host 声明并经 Runtime 校验');
    expect(documentation).toContain('不代表 Agent 的内部思考过程');

    for (const health of semantics.healthKinds) {
      containsTableCell(documentation, health.label);
      containsTableCell(documentation, health.target);
    }
    expect(documentation).toContain('四类信号彼此独立');
    expect(documentation).toContain('未知不等于正常');
  });
});
