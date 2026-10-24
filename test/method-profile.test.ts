import { describe, expect, it } from 'vitest';

import {
  BUILTIN_METHOD_PROFILE_REGISTRY,
  MethodProfileRegistry,
} from '../domains/change-lifecycle/method-profile.js';
import {
  BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
  assertChangeLifecycleDefinition,
} from '../domains/change-lifecycle/definition.js';

describe('Method Profile registry', () => {
  it('assembles only reviewed rules for their declared phase, artifact, and enforcement', () => {
    const profile = BUILTIN_METHOD_PROFILE_REGISTRY.snapshot('repoctopus.design', '1.0.0');
    const assembled = BUILTIN_METHOD_PROFILE_REGISTRY.assemble({
      profile,
      phase: 'design',
      artifactKinds: ['design', 'tasks'],
    });
    expect(profile.sourceDigests).toEqual(
      expect.arrayContaining([
        'sha256:c73a2250beac0479e384f5466e834bb54ce6e30b7f8705e9999ba840d9d59b36',
        'sha256:b8eb6dca1085e85220b0f5990ed787ebf8a924844d090689f1073b06367e2f7a',
      ]),
    );
    expect(assembled.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'design.public-test-seams',
          phases: ['design', 'build'],
          artifactKinds: ['design'],
          enforcement: 'human-decision',
        }),
        expect.objectContaining({
          id: 'tasks.explicit-blocking-edges',
          artifactKinds: ['tasks'],
          enforcement: 'deterministic-validator',
        }),
      ]),
    );
    expect(JSON.stringify(assembled)).not.toContain('publish-spec-to-issue-tracker');
    expect(JSON.stringify(assembled)).not.toContain('SKILL.md');

    const tampered = structuredClone(profile);
    tampered.ruleIds = [...tampered.ruleIds, 'unreviewed-rule'];
    expect(() =>
      BUILTIN_METHOD_PROFILE_REGISTRY.assemble({
        profile: tampered,
        phase: 'design',
        artifactKinds: ['design'],
      }),
    ).toThrow(/snapshot drifted/u);
    expect(() => new MethodProfileRegistry()).not.toThrow();
  });

  it.each(['to-spec', 'to-tickets']) (
    'rejects a user Skill named %s from every lifecycle Work binding',
    (name) => {
      const definition = structuredClone(BUILTIN_CHANGE_LIFECYCLE_DEFINITION);
      definition.works.find((work) => work.kind === 'task.implement')!.actionSkill = {
        name,
      };
      expect(() => assertChangeLifecycleDefinition(definition)).toThrow(
        new RegExp(`behavior-only reference: ${name}`, 'u'),
      );
    },
  );
});
