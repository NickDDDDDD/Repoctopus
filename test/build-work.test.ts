import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { BUILTIN_CHANGE_LIFECYCLE_DEFINITION } from '../domains/change-lifecycle/definition.js';
import {
  buildActionSkillComposition,
  createBuildActionWork,
} from '../domains/change-lifecycle/build-work.js';
import type { SkillUsageSnapshot } from '../domains/skill/types.js';

const digest = (value: string) =>
  `sha256:${createHash('sha256').update(value).digest('hex')}` as const;

function skill(name: string): SkillUsageSnapshot {
  return {
    schemaVersion: 1,
    name,
    provider: 'test',
    invocation: { modelInvocable: true, userInvocable: false },
    contentDigest: digest(`${name}:content`),
    resourceManifestDigest: digest(`${name}:resources`),
  };
}

function executeWork(input: { tddMode: 'tdd' | 'direct'; augmentations: readonly string[] }) {
  return createBuildActionWork({
    runId: 'run-build-work',
    checkEpoch: 4,
    definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
    kind: 'build.execute',
    actionSkill: skill('repoctopus-build-execute'),
    augmentationSkills: input.augmentations.map(skill),
    compositionDigest: digest('composition'),
    projectConfigDigest: digest('project-config'),
    projectSnapshotDigest: digest('project-snapshot'),
    workspaceRepositoryId: 'workspace',
    repositoryIds: ['workspace'],
    configurationId: 'configuration-1',
    planId: 'plan-1',
    planRevision: 1,
    packageId: 'package-1',
    executionMode: 'autonomous',
    tddMode: input.tddMode,
    writeScopes: [{ repositoryId: 'workspace', paths: ['domains/**'] }],
    stableInput: { packageDigest: digest('package') },
  });
}

describe('Build Work policy', () => {
  it('derives the exact ordered Skill composition from Action and frozen TDD mode', () => {
    expect(buildActionSkillComposition({ action: 'configure' })).toEqual({
      actionSkill: 'repoctopus-build-configure',
      augmentationSkills: [],
    });
    expect(buildActionSkillComposition({ action: 'plan' })).toEqual({
      actionSkill: 'repoctopus-build-plan',
      augmentationSkills: [],
    });
    expect(buildActionSkillComposition({ action: 'execute', tddMode: 'tdd' })).toEqual({
      actionSkill: 'repoctopus-build-execute',
      augmentationSkills: ['tdd'],
    });
    expect(buildActionSkillComposition({ action: 'execute', tddMode: 'direct' })).toEqual({
      actionSkill: 'repoctopus-build-execute',
      augmentationSkills: [],
    });
    expect(buildActionSkillComposition({ action: 'check', tddMode: 'direct' })).toEqual({
      actionSkill: 'repoctopus-build-check',
      augmentationSkills: ['code-review'],
    });
  });

  it('binds mode to the Work digest and rejects caller-selected Skill changes', () => {
    const tdd = executeWork({ tddMode: 'tdd', augmentations: ['tdd'] });
    const direct = executeWork({ tddMode: 'direct', augmentations: [] });

    expect(tdd).toMatchObject({
      buildAction: 'execute',
      executionMode: 'autonomous',
      tddMode: 'tdd',
      augmentationSkills: [{ name: 'tdd' }],
    });
    expect(direct).toMatchObject({ tddMode: 'direct', augmentationSkills: [] });
    expect(tdd.inputDigest).not.toBe(direct.inputDigest);
    expect(() => executeWork({ tddMode: 'direct', augmentations: ['tdd'] })).toThrow(
      /frozen policy/u,
    );
    expect(() => executeWork({ tddMode: 'tdd', augmentations: [] })).toThrow(/frozen policy/u);
  });
});
