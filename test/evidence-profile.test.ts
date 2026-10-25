import { describe, expect, it } from 'vitest';

import { blockedNodes, compileEvidenceProfile } from '../domains/feedback/profile.js';
import type { EffectiveProjectConfig } from '../domains/project-configuration/types.js';

function effective(
  nodes: EffectiveProjectConfig['shared']['profiles'][number]['nodes'],
): EffectiveProjectConfig {
  return {
    shared: {
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'RepoctopusWorkspace',
      workspace: { id: 'sample', repositoryId: 'workspace' },
      repositories: [
        { id: 'workspace', path: '.' },
        { id: 'front', path: '../front' },
        { id: 'back', path: '../back' },
      ],
      profiles: [{ id: 'verify', nodes }],
    },
    local: null,
    repositories: [
      { id: 'front', path: '../front', resolvedPath: '/workspace/front' },
      { id: 'back', path: '../back', resolvedPath: '/workspace/back' },
    ],
    sharedDigest: 'shared',
    localDigest: null,
    effectiveDigest: 'effective',
  };
}

function command(
  id: string,
  repository: string,
  dependsOn: string[] = [],
): EffectiveProjectConfig['shared']['profiles'][number]['nodes'][number] {
  return {
    id,
    type: 'command',
    repository,
    dependsOn,
    required: true,
    covers: [],
    executable: 'node',
    args: ['--version'],
    timeoutMs: 1000,
    cache: false,
  };
}

describe('evidence profile compiler', () => {
  it('produces a stable topological order and resolves repository paths', () => {
    const plan = compileEvidenceProfile(
      effective([
        command('front-build', 'front', ['design-build']),
        command('back-build', 'back'),
        command('design-build', 'front'),
      ]),
      'verify',
    );
    expect(plan.order).toEqual(['back-build', 'design-build', 'front-build']);
    expect(plan.nodes.find((node) => node.id === 'back-build')?.repositoryPath).toBe(
      '/workspace/back',
    );
  });

  it('rejects dependency cycles before execution', () => {
    expect(() =>
      compileEvidenceProfile(
        effective([command('a', 'front', ['b']), command('b', 'back', ['a'])]),
        'verify',
      ),
    ).toThrow(/cycle/i);
  });

  it('blocks only nodes whose dependency did not pass', () => {
    const plan = compileEvidenceProfile(
      effective([
        command('front', 'front', ['design']),
        command('back', 'back'),
        command('design', 'front'),
      ]),
      'verify',
    );
    expect(
      blockedNodes(
        plan,
        new Map([
          ['design', 'failed'],
          ['back', 'passed'],
        ]),
      ),
    ).toEqual(['front']);
  });
});
