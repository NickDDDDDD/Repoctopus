import { describe, expect, it } from 'vitest';

import { parseSharedProjectConfig } from '../domains/project-configuration/config.js';

function project(inputs: unknown) {
  return {
    apiVersion: 'repoctopus/v1alpha1',
    kind: 'RepoctopusWorkspace',
    workspace: { id: 'input-policy', repositoryId: 'workspace' },
    repositories: [
      { id: 'workspace', path: '.' },
      { id: 'frontend', path: '../frontend' },
    ],
    profiles: [
      {
        id: 'verify',
        nodes: [
          {
            id: 'test',
            type: 'command',
            repository: 'frontend',
            executable: 'node',
            args: ['test.mjs'],
            inputs,
          },
        ],
      },
    ],
  };
}

describe('Evidence command input declarations', () => {
  it('accepts a versioned declaration and makes its defaults explicit', () => {
    expect(() =>
      parseSharedProjectConfig(
        project({
          schemaVersion: 1,
          repositories: [{ repository: 'frontend', files: ['src/**', 'package.json'] }],
        }),
      ),
    ).not.toThrow();
    const config = parseSharedProjectConfig(
      project({
        schemaVersion: 1,
        repositories: [{ repository: 'frontend', files: ['src/**', 'package.json'] }],
      }),
    );
    expect(config.profiles[0]!.nodes[0]).toMatchObject({
      inputs: {
        schemaVersion: 1,
        repositories: [{ repository: 'frontend', files: ['package.json', 'src/**'], outputs: [] }],
        git: 'none',
        taskCheckboxes: 'ignore',
        env: [],
      },
    });
  });

  it('preserves explicit Git, checkbox and environment dependencies', () => {
    const config = parseSharedProjectConfig(
      project({
        schemaVersion: 1,
        git: 'all',
        taskCheckboxes: 'include',
        env: ['TZ', 'NODE_ENV'],
      }),
    );
    expect(config.profiles[0]!.nodes[0]).toMatchObject({
      inputs: { git: 'all', taskCheckboxes: 'include', env: ['NODE_ENV', 'TZ'] },
    });
  });

  it.each([
    { schemaVersion: 2 },
    { schemaVersion: 1, repositories: [] },
    { schemaVersion: 1, repositories: [{ repository: 'frontend', files: [] }] },
    { schemaVersion: 1, repositories: [{ repository: 'missing' }] },
    { schemaVersion: 1, repositories: [{ repository: 'frontend', files: ['../secret'] }] },
    { schemaVersion: 1, repositories: [{ repository: 'frontend', files: ['C:/secret'] }] },
    { schemaVersion: 1, repositories: [{ repository: 'frontend', outputs: ['/outside/**'] }] },
    { schemaVersion: 1, env: ['BAD=NAME'] },
    { schemaVersion: 1, git: 'sometimes' },
    { schemaVersion: 1, ignoreEverything: true },
  ])('rejects unsafe, ambiguous or unsupported declarations %#', (inputs) => {
    expect(() => parseSharedProjectConfig(project(inputs))).toThrow();
  });
});
