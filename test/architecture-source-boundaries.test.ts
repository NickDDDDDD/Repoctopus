import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { evaluateSourceBoundaries } from '../scripts/architecture-source-boundaries.mjs';

interface SourceFixture {
  path: string;
  contents: string;
}

interface Fixtures {
  secondContainers: SourceFixture[];
  legacyPostMergeConfig: SourceFixture[];
  platformRunWrite: SourceFixture[];
  coordinatorStoreWrite: SourceFixture[];
  nonProviderClosure: SourceFixture[];
  unprotectedPublication: SourceFixture[];
  desktopIsolation: SourceFixture[];
  lifecyclePhaseOwner: SourceFixture[];
  directRunStateWrite: SourceFixture[];
  independentPostMergeRun: SourceFixture[];
  callerSelectedLifecycleSkill: SourceFixture[];
}

interface Rule {
  id: string;
  targets?: string[];
  pattern: string;
  allowed: string[];
  exactMatches?: number;
  message: string;
}

const root = path.resolve(import.meta.dirname, '..');
const policy = JSON.parse(
  await readFile(path.join(root, 'scripts', 'architecture-governance.json'), 'utf8'),
) as { sourceBoundaries: Rule[] };
const fixtures = JSON.parse(
  await readFile(
    path.join(root, 'test', 'fixtures', 'architecture-boundary-violations.json'),
    'utf8',
  ),
) as Fixtures;

function rules(...ids: string[]): Rule[] {
  return ids.map((id) => {
    const rule = policy.sourceBoundaries.find((candidate) => candidate.id === id);
    if (!rule) throw new Error(`Missing architecture source boundary fixture rule: ${id}`);
    return rule;
  });
}

async function canonicalContainers(): Promise<SourceFixture[]> {
  return Promise.all(
    ['plugins/builtin-catalog.ts', 'services/specification.ts'].map(async (source) => ({
      path: source,
      contents: await readFile(path.join(root, source), 'utf8'),
    })),
  );
}

describe('architecture source boundaries', () => {
  it('allows alternate Providers to extend the single Specification container', async () => {
    const findings = evaluateSourceBoundaries(
      [
        ...(await canonicalContainers()),
        {
          path: 'platform/specification/alternate-provider.ts',
          contents: 'export class AlternateProvider extends Specification {}',
        },
      ],
      rules('single-skill-container', 'single-specification-container'),
    );

    expect(findings).toEqual([]);
  });

  it('rejects a second Skill or Specification container without banning alternate providers', async () => {
    const findings = evaluateSourceBoundaries(
      [...(await canonicalContainers()), ...fixtures.secondContainers],
      rules('single-skill-container', 'single-specification-container'),
    );

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('plugins/rogue-skill-container.ts: single-skill-container'),
        expect.stringContaining('services/rogue-specification.ts: single-specification-container'),
        expect.stringContaining('single-skill-container: expected exactly 1'),
        expect.stringContaining('single-specification-container: expected exactly 1'),
      ]),
    );
  });

  it('rejects a platform Adapter that calls the Run service directly', () => {
    expect(
      evaluateSourceBoundaries(fixtures.platformRunWrite, rules('platform-adapter-run-write')),
    ).toEqual([
      expect.stringContaining('platform/github/rogue-event-adapter.ts: platform-adapter-run-write'),
    ]);
  });

  it('keeps legacy update-existing configuration out of Delivery v3 composition', () => {
    expect(
      evaluateSourceBoundaries(
        fixtures.legacyPostMergeConfig,
        rules('v3-post-merge-configuration'),
      ),
    ).toEqual([
      expect.stringContaining(
        'plugins/post-merge/rogue-actions-provider.ts: v3-post-merge-configuration',
      ),
    ]);
  });

  it('rejects a PostMergeCoordinator that writes a domain Store directly', () => {
    expect(
      evaluateSourceBoundaries(
        fixtures.coordinatorStoreWrite,
        rules('coordinator-domain-store-write'),
      ),
    ).toEqual([
      expect.stringContaining('services/post-merge-coordinator.ts: coordinator-domain-store-write'),
    ]);
  });

  it('rejects Specification closure execution outside a Provider', () => {
    expect(
      evaluateSourceBoundaries(
        fixtures.nonProviderClosure,
        rules('specification-provider-closure'),
      ),
    ).toEqual([
      expect.stringContaining(
        'services/rogue-specification-closer.ts: specification-provider-closure',
      ),
    ]);
  });

  it('rejects unprotected Git and merge-request publication', () => {
    expect(
      evaluateSourceBoundaries(
        fixtures.unprotectedPublication,
        rules('protected-git-publication', 'protected-merge-request-publication'),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('platform/git/rogue-publisher.ts: protected-git-publication'),
        expect.stringContaining(
          'platform/github/rogue-publisher.ts: protected-merge-request-publication',
        ),
      ]),
    );
  });

  it('keeps the Desktop Renderer and Electron Shell outside the Cordis process boundary', () => {
    expect(
      evaluateSourceBoundaries(
        fixtures.desktopIsolation,
        rules('desktop-renderer-process-isolation', 'desktop-shell-cordis-isolation'),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'app/desktop/renderer/src/rogue.tsx: desktop-renderer-process-isolation',
        ),
        expect.stringContaining('app/desktop/main/rogue.ts: desktop-shell-cordis-isolation'),
      ]),
    );
  });

  it('allows only the canonical domain module to own Change phase transitions', () => {
    const allowed = [
      {
        path: 'domains/change-lifecycle/transition.ts',
        contents:
          "export type ChangePhase = 'open' | 'design' | 'build' | 'verify' | 'archive'; export function decideChangeLifecycleTransition() { return 'open'; }",
      },
    ];

    expect(
      evaluateSourceBoundaries(allowed, rules('single-change-lifecycle-transition-owner')),
    ).toEqual([]);
    expect(
      evaluateSourceBoundaries(
        [
          {
            path: 'domains/change-lifecycle/definition.ts',
            contents: "import { type ChangePhase } from './transition.js';",
          },
        ],
        rules('single-change-lifecycle-transition-owner'),
      ),
    ).toEqual([]);
    expect(
      evaluateSourceBoundaries(
        fixtures.lifecyclePhaseOwner,
        rules('single-change-lifecycle-transition-owner'),
      ),
    ).toEqual([
      expect.stringContaining(
        'services/rogue-lifecycle.ts: single-change-lifecycle-transition-owner',
      ),
    ]);
  });

  it('rejects direct Run state writes outside WorkflowRuns', () => {
    expect(
      evaluateSourceBoundaries(
        [
          {
            path: 'services/lifecycle-runner.ts',
            contents: 'export async function next(context) { return context.workflowRuns.next(); }',
          },
        ],
        rules('direct-run-state-write'),
      ),
    ).toEqual([]);
    expect(
      evaluateSourceBoundaries(fixtures.directRunStateWrite, rules('direct-run-state-write')),
    ).toEqual([expect.stringContaining('services/rogue-run-writer.ts: direct-run-state-write')]);
  });

  it('contains independent Post-merge Run creation to the legacy compatibility path', () => {
    const allowed = [
      {
        path: 'domains/post-merge/run.ts',
        contents: 'export function postMergeRunOptions(input) { return input; }',
      },
      {
        path: 'services/post-merge-coordinator.ts',
        contents: 'export function start(input) { return postMergeRunOptions(input); }',
      },
    ];

    expect(evaluateSourceBoundaries(allowed, rules('independent-post-merge-run-creation'))).toEqual(
      [],
    );
    expect(
      evaluateSourceBoundaries(
        fixtures.independentPostMergeRun,
        rules('independent-post-merge-run-creation'),
      ),
    ).toEqual([
      expect.stringContaining(
        'plugins/events/rogue-post-merge.ts: independent-post-merge-run-creation',
      ),
    ]);
  });

  it('rejects caller-selected lifecycle Skills and Method Profiles', () => {
    expect(
      evaluateSourceBoundaries(
        [
          {
            path: 'domains/change-lifecycle/definition.ts',
            contents:
              "export const work = { actionSkill: { name: 'openspec-apply-change' }, methodProfile: BUILTIN_METHOD_PROFILE };",
          },
        ],
        rules('caller-selected-lifecycle-method'),
      ),
    ).toEqual([]);
    expect(
      evaluateSourceBoundaries(
        fixtures.callerSelectedLifecycleSkill,
        rules('caller-selected-lifecycle-method'),
      ),
    ).toEqual([
      expect.stringContaining('app/cli/rogue-lifecycle.ts: caller-selected-lifecycle-method'),
    ]);
  });
});
