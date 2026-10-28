import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { BUILTIN_CHANGE_LIFECYCLE_DEFINITION } from '../domains/change-lifecycle/definition.js';

describe('managed Build protocol characterization', () => {
  it('declares Configure, Plan, Execute, and Check as distinct Runtime-selected Work', () => {
    const build = BUILTIN_CHANGE_LIFECYCLE_DEFINITION.phases.find(
      (candidate) => candidate.phase === 'build',
    );

    expect(build?.workKinds).toEqual([
      'build.configure',
      'build.plan',
      'build.execute',
      'build.check',
    ]);
  });

  it('does not create implementation Work directly from an OpenSpec Task', async () => {
    const source = await readFile(
      new URL('../domains/change-lifecycle/build-work.ts', import.meta.url),
      'utf8',
    );

    expect(source).not.toContain("kind: 'task.implement'");
    expect(source).not.toContain('readySpecificationTasks');
  });

  it('selects TDD from frozen Build Configuration rather than a fixed phase skill', () => {
    const buildWorks = BUILTIN_CHANGE_LIFECYCLE_DEFINITION.works.filter(
      (work) => work.phase === 'build',
    );

    expect(buildWorks).toHaveLength(4);
    expect(buildWorks.every((work) => work.augmentationSkills.length === 0)).toBe(true);
  });

  it('requires separate Plan and Check validators', () => {
    const build = BUILTIN_CHANGE_LIFECYCLE_DEFINITION.phases.find(
      (candidate) => candidate.phase === 'build',
    );

    expect(build?.requiredValidatorProfiles).toEqual(
      expect.arrayContaining([
        'build.configuration-approved',
        'build.plan-valid',
        'build.plan-evidence-valid',
        'build.package-valid',
        'build.check-valid',
      ]),
    );
  });

  it('contains no production Task reopen or special Repair Work continuation', async () => {
    const [service, transition, projection] = await Promise.all([
      readFile(new URL('../services/workflow-runs.ts', import.meta.url), 'utf8'),
      readFile(new URL('../domains/change-lifecycle/transition.ts', import.meta.url), 'utf8'),
      readFile(new URL('../domains/runtime/workflow-runs.ts', import.meta.url), 'utf8'),
    ]);
    const production = `${service}\n${transition}\n${projection}`;

    expect(production).not.toContain("id: 'verify.repair'");
    expect(production).not.toContain('implementation.repair');
    expect(production).not.toContain('real reopened Repair Work');
    expect(service).not.toContain('const reopened = taskSet.tasks.map');
  });
});
