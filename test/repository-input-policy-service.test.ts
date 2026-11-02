import { Context } from '@deepseek-ai/cordis';
import { describe, expect, it } from 'vitest';

import { BUILTIN_HOST_INPUT_CONTRIBUTOR } from '../plugins/evidence/builtin-host-input-policy.js';
import { RepositoryInputPolicies } from '../services/repository-input-policies.js';

describe('Repository Input Policy service', () => {
  it('compiles registered Contributors into one deterministic policy', () => {
    const service = new RepositoryInputPolicies(new Context());
    const dispose = service.register(BUILTIN_HOST_INPUT_CONTRIBUTOR);

    expect(service.current().contributors).toEqual([
      { id: 'repoctopus-host-inputs', version: '1.0.0' },
    ]);
    expect(service.current().rules.map((rule) => rule.path)).toEqual([
      '.agents/skills',
      '.codex/hooks.json',
      '.codex/rules',
      'AGENTS.md',
      'skills-lock.json',
    ]);
    dispose();
    expect(service.current().rules).toEqual([]);
  });

  it('rejects duplicate Contributor identity without changing the active policy', () => {
    const service = new RepositoryInputPolicies(new Context());
    service.register(BUILTIN_HOST_INPUT_CONTRIBUTOR);
    expect(() => service.register(structuredClone(BUILTIN_HOST_INPUT_CONTRIBUTOR))).toThrow(
      /already registered/u,
    );
    expect(service.current().contributors).toHaveLength(1);
  });
});
