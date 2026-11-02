import { describe, expect, it } from 'vitest';

import {
  classifyRepositoryInput,
  compileRepositoryInputPolicy,
  type RepositoryInputPolicyContributor,
} from '../domains/evidence/repository-input-policy.js';

function contributor(
  rules: RepositoryInputPolicyContributor['rules'],
): RepositoryInputPolicyContributor {
  return {
    identity: {
      id: 'codex-host-inputs',
      version: '1.0.0',
    },
    rules,
  };
}

describe('Repository Input Policy', () => {
  it('compiles a deterministic default-deny policy', () => {
    const rules: RepositoryInputPolicyContributor['rules'] = [
      {
        id: 'agent-instructions',
        owner: 'codex-host-inputs',
        path: 'AGENTS.md',
        match: 'file',
        tracked: 'product',
        allowedKinds: ['file'],
      },
      {
        id: 'codex-rules',
        owner: 'codex-host-inputs',
        path: '.codex/rules',
        match: 'tree',
        tracked: 'conflict',
        allowedKinds: ['file'],
      },
    ];
    const first = compileRepositoryInputPolicy([contributor(rules)]);
    const second = compileRepositoryInputPolicy([contributor([...rules].reverse())]);

    expect(first.digest).toBe(second.digest);
    expect(first.rules.map((rule) => rule.id)).toEqual(['codex-rules', 'agent-instructions']);
    expect(classifyRepositoryInput(first, '.codex/rules/workflow.md', false)).toMatchObject({
      kind: 'control-plane',
      ruleId: 'codex-rules',
    });
    expect(classifyRepositoryInput(first, 'AGENTS.md', true)).toEqual({ kind: 'product' });
    expect(classifyRepositoryInput(first, '.codex/rules/workflow.md', true)).toMatchObject({
      kind: 'conflict',
      ruleId: 'codex-rules',
    });
    expect(classifyRepositoryInput(first, '.codex/unknown.json', false)).toEqual({
      kind: 'product',
    });
  });

  it.each(['../escape', '/absolute', 'C:/absolute', './relative', 'nested//file'])(
    'rejects unsafe rule path %s',
    (unsafe) => {
      expect(() =>
        compileRepositoryInputPolicy([
          contributor([
            {
              id: 'unsafe',
              owner: 'codex-host-inputs',
              path: unsafe,
              match: 'file',
              tracked: 'product',
              allowedKinds: ['file'],
            },
          ]),
        ]),
      ).toThrow(/path/u);
    },
  );

  it('rejects case-insensitive overlap and duplicate contributor ownership', () => {
    expect(() =>
      compileRepositoryInputPolicy([
        contributor([
          {
            id: 'root',
            owner: 'codex-host-inputs',
            path: '.codex',
            match: 'tree',
            tracked: 'conflict',
            allowedKinds: ['file'],
          },
          {
            id: 'nested',
            owner: 'codex-host-inputs',
            path: '.CODEX/rules',
            match: 'tree',
            tracked: 'conflict',
            allowedKinds: ['file'],
          },
        ]),
      ]),
    ).toThrow(/overlap/u);

    expect(() => compileRepositoryInputPolicy([contributor([]), contributor([])])).toThrow(
      /duplicate Contributor/u,
    );
  });
});
