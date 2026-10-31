import { Context } from '@deepseek-ai/cordis';
import { describe, expect, it } from 'vitest';

import { BUILTIN_CHANGE_LIFECYCLE_DEFINITION } from '../domains/change-lifecycle/definition.js';
import {
  assertSafeLifecycleExtension,
  lifecycleContributorIdentity,
  lifecycleExtensionFindings,
  type LifecycleExtensionContributor,
} from '../domains/change-lifecycle/contributors.js';
import builtinDefinition from '../plugins/lifecycle/builtin-definition-contributor.js';
import builtinExtension from '../plugins/lifecycle/builtin-extension-contributor.js';
import builtinValidators from '../plugins/lifecycle/builtin-validator-contributor.js';
import {
  LifecycleDefinitions,
  LifecycleExtensions,
  LifecycleValidators,
} from '../services/lifecycle-contributors.js';

describe('lifecycle Cordis Contributors', () => {
  it('installs independent Definition, Validator, and Extension contracts with stable snapshots', async () => {
    const context = new Context();
    const services = [
      context.plugin(LifecycleDefinitions),
      context.plugin(LifecycleValidators),
      context.plugin(LifecycleExtensions),
    ];
    await Promise.all(services);
    const contributors = [
      context.plugin(builtinDefinition),
      context.plugin(builtinValidators),
      context.plugin(builtinExtension),
    ];
    await Promise.all(contributors);

    expect(context.lifecycleDefinitions.current().definition.id).toBe(
      BUILTIN_CHANGE_LIFECYCLE_DEFINITION.id,
    );
    expect(context.lifecycleValidators.resolve('verify.evidence-gate').identity.kind).toBe(
      'validator',
    );
    expect(context.lifecycleExtensions.list()).toMatchObject([
      { identity: { id: 'repoctopus.core-checkpoints', kind: 'extension' } },
    ]);
    expect(context.lifecycleDefinitions.current().identity.compatibleWith).toEqual(['4.5.0']);
    expect(
      context.lifecycleValidators.resolve('verify.evidence-gate').identity.compatibleWith,
    ).toEqual(['4.5.0']);
    expect(context.lifecycleExtensions.list()[0]?.identity.compatibleWith).toEqual(['4.5.0']);
    for (const snapshot of [
      context.lifecycleDefinitions.snapshot(),
      context.lifecycleValidators.snapshot(),
      context.lifecycleExtensions.snapshot(),
    ]) {
      expect(snapshot.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(snapshot.contributors).toHaveLength(1);
    }

    await Promise.all(contributors.map((fiber) => fiber.dispose()));
    expect(() => context.lifecycleDefinitions.current()).toThrow(/found 0/u);
    expect(() => context.lifecycleValidators.resolve('verify.evidence-gate')).toThrow(/found 0/u);
    expect(context.lifecycleExtensions.list()).toEqual([]);
    await context.fiber.dispose();
  });

  it('keeps a dependent Contributor pending until its Service exists and drains on unload', async () => {
    const context = new Context();
    const pending = context.plugin(builtinDefinition);
    await Promise.resolve();
    expect('lifecycleDefinitions' in context).toBe(false);

    const service = context.plugin(LifecycleDefinitions);
    await Promise.all([service, pending]);
    expect(context.lifecycleDefinitions.current().identity.id).toBe('repoctopus.change-lifecycle');

    await expect(
      Promise.race([
        pending.dispose().then(() => 'disposed'),
        new Promise<string>((resolve) => setTimeout(() => resolve('timed-out'), 1_000)),
      ]),
    ).resolves.toBe('disposed');
    expect(() => context.lifecycleDefinitions.current()).toThrow(/found 0/u);
    await context.fiber.dispose();
  });

  it('accepts additive validation and fails closed for transition, gate, archive, and scope abuse', () => {
    const digest = `sha256:${'a'.repeat(64)}` as const;
    const base: LifecycleExtensionContributor = {
      identity: lifecycleContributorIdentity({
        kind: 'extension',
        id: 'team.license-check',
        version: '1.0.0',
        codeDigest: digest,
        configDigest: digest,
      }),
      declaredCapabilities: ['repository.read'],
      declaredWriteScopes: [],
      works: [],
      validations: [
        { profileId: 'team.license-valid', checkpoint: 'build.after-execute', required: true },
      ],
    };
    expect(() =>
      assertSafeLifecycleExtension(base, BUILTIN_CHANGE_LIFECYCLE_DEFINITION),
    ).not.toThrow();

    const malicious: LifecycleExtensionContributor[] = [
      { ...base, requestedTransitions: [{ from: 'open', to: 'build' }] },
      { ...base, bypass: { designApproval: true } },
      {
        ...base,
        declaredCapabilities: ['specification.write'],
        works: [
          {
            kind: 'team.early-archive',
            checkpoint: 'archive.before-close',
            capabilities: ['specification.write'],
            sideEffectClass: 'specification-write',
            writeScopes: [],
          },
        ],
      },
      {
        ...base,
        works: [
          {
            kind: 'team.unbounded-write',
            checkpoint: 'build.after-execute',
            capabilities: ['repository.read'],
            sideEffectClass: 'repository-write',
            writeScopes: [
              {
                repositorySelector: 'all-repositories',
                paths: ['**'],
                operations: ['create', 'update', 'delete'],
              },
            ],
          },
        ],
      },
      {
        ...base,
        validations: [
          { profileId: 'team.license-valid', checkpoint: 'design.before-approval', required: true },
        ],
      },
    ];
    expect(
      malicious.map((extension) =>
        lifecycleExtensionFindings(extension, BUILTIN_CHANGE_LIFECYCLE_DEFINITION),
      ),
    ).toEqual([
      ['core-transition-requested'],
      ['protected-gate-bypass-requested'],
      ['premature-specification-archive:team.early-archive'],
      ['undeclared-write-scope:team.unbounded-write'],
      ['undeclared-checkpoint:design.before-approval'],
    ]);
  });
});
