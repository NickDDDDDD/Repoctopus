import type { Plugin } from '@deepseek-ai/cordis';
import { describe, expect, it } from 'vitest';

import { compileComposition } from '../app/boot/composition.js';
import {
  createBuiltinCatalog,
  descriptorDigest,
  normalizePluginDescriptor,
  PLUGIN_CONTRACT_VERSION,
  type BuiltinPluginRegistration,
  type PluginDescriptor,
} from '../app/boot/descriptor.js';

const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

function registration(
  id: string,
  options: {
    authorities?: readonly string[];
    plugin?: Plugin;
  } = {},
): BuiltinPluginRegistration {
  return {
    descriptor: {
      id,
      version: '1.0.0',
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      codeDigest: digest(id === 'run-store-a' ? 'a' : id === 'run-store-b' ? 'b' : 'c'),
      compositions: ['bootstrap', 'project'],
      authorities: options.authorities ?? [],
      permissions: [],
      stateSchemas: {},
    },
    plugin: options.plugin ?? (() => undefined),
  };
}

describe('plugin descriptor', () => {
  it('normalizes unordered set and map fields before hashing', () => {
    const first: PluginDescriptor = {
      ...registration('run-store-a').descriptor,
      compositions: ['project', 'bootstrap'],
      authorities: ['workflow-write', 'checkpoint-write'],
      permissions: ['process', 'filesystem'],
      stateSchemas: { run: 'v1', checkpoint: 'v2' },
    };
    const second: PluginDescriptor = {
      ...first,
      compositions: ['bootstrap', 'project'],
      authorities: ['checkpoint-write', 'workflow-write'],
      permissions: ['filesystem', 'process'],
      stateSchemas: { checkpoint: 'v2', run: 'v1' },
    };

    expect(normalizePluginDescriptor(first)).toEqual(normalizePluginDescriptor(second));
    expect(descriptorDigest(first)).toBe(descriptorDigest(second));
  });

  it('rejects duplicate plugin identities', () => {
    expect(() =>
      createBuiltinCatalog([registration('run-store-a'), registration('run-store-a')]),
    ).toThrow('Duplicate plugin id: run-store-a');
  });
});

describe('composition compiler', () => {
  it('produces one stable identity for equivalent plugin and config order', () => {
    const catalog = createBuiltinCatalog([
      registration('project-probe'),
      registration('run-store-a', { authorities: ['run-store-write'] }),
    ]);
    const first = compileComposition(
      {
        id: 'project',
        kind: 'project',
        plugins: [
          { id: 'run-store-a', config: { mode: 'normal', limits: { runs: 2 } } },
          { id: 'project-probe' },
        ],
        requiredServices: ['workflowRuns', 'project'],
      },
      catalog,
    );
    const second = compileComposition(
      {
        id: 'project',
        kind: 'project',
        plugins: [
          { id: 'project-probe' },
          { id: 'run-store-a', config: { limits: { runs: 2 }, mode: 'normal' } },
        ],
        requiredServices: ['project', 'workflowRuns'],
      },
      catalog,
    );

    expect(first.compositionDigest).toBe(second.compositionDigest);
    expect(first.entries.map((entry) => entry.id)).toEqual(['project-probe', 'run-store-a']);
  });

  it('rejects an unknown plugin without evaluating any plugin body', () => {
    let evaluated = false;
    const catalog = createBuiltinCatalog([
      registration('project-probe', {
        plugin: () => {
          evaluated = true;
        },
      }),
    ]);

    expect(() =>
      compileComposition(
        {
          id: 'broken',
          kind: 'project',
          plugins: [{ id: 'project-probe' }, { id: 'not-admitted' }],
        },
        catalog,
      ),
    ).toThrow('Unknown plugin: not-admitted');
    expect(evaluated).toBe(false);
  });

  it('rejects two owners of the same write authority', () => {
    const catalog = createBuiltinCatalog([
      registration('run-store-a', { authorities: ['run-store-write'] }),
      registration('run-store-b', { authorities: ['run-store-write'] }),
    ]);

    expect(() =>
      compileComposition(
        {
          id: 'ambiguous',
          kind: 'project',
          plugins: [{ id: 'run-store-a' }, { id: 'run-store-b' }],
        },
        catalog,
      ),
    ).toThrow('Authority run-store-write has multiple owners: run-store-a, run-store-b');
  });

  it('does not require a product Runtime in either composition', () => {
    const catalog = createBuiltinCatalog([registration('project-probe')]);
    expect(
      compileComposition(
        {
          id: 'bootstrap',
          kind: 'bootstrap',
          plugins: [{ id: 'project-probe' }],
        },
        catalog,
      ).kind,
    ).toBe('bootstrap');
  });
});
