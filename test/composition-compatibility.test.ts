import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { compareCompositions } from '../domains/composition/compatibility.js';
import type {
  CompositionIdentitySnapshot,
  PluginImplementationIdentity,
} from '../domains/composition/types.js';
import { createRepoctopusBuiltinCatalog } from '../plugins/builtin-catalog.js';

const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

function plugin(
  id: string,
  code: string,
  authorities: string[] = [],
  stateSchemas: Record<string, string> = {},
  compatibleImplementations?: PluginImplementationIdentity['compatibleImplementations'],
): PluginImplementationIdentity {
  return {
    id,
    version: '1.0.0',
    configDigest: digest('a'),
    codeDigest: digest(code),
    descriptorDigest: digest(code),
    authorities,
    stateSchemas,
    ...(compatibleImplementations ? { compatibleImplementations } : {}),
  };
}

function composition(
  compositionDigest: `sha256:${string}`,
  plugins: PluginImplementationIdentity[],
): CompositionIdentitySnapshot {
  return { id: 'project', kind: 'project', compositionDigest, plugins };
}

describe('composition compatibility', () => {
  it('accepts changes limited to stateless plugins without protected authority', () => {
    const before = composition(digest('1'), [plugin('telemetry', 'a')]);
    const after = composition(digest('2'), [plugin('telemetry', 'b')]);
    expect(compareCompositions(before, after)).toMatchObject({
      status: 'compatible',
      changedPluginIds: ['telemetry'],
    });
  });

  it('requires migration when a protected or stateful plugin changes', () => {
    const before = composition(digest('1'), [
      plugin('workflow-runs', 'a', ['workflow-transition'], { run: '1' }),
    ]);
    const after = composition(digest('2'), [
      plugin('workflow-runs', 'b', ['workflow-transition'], { run: '1' }),
    ]);
    expect(compareCompositions(before, after)).toMatchObject({
      status: 'migration_required',
      changedPluginIds: ['workflow-runs'],
    });
  });

  it('ignores changed protected plugins outside the current checkpoint dependency closure', () => {
    const before = composition(digest('1'), [
      plugin('workflow-runs', 'a', ['workflow-transition'], { run: '1' }),
      plugin('unused-provider', 'a', ['specification-authority'], { state: '1' }),
    ]);
    const after = composition(digest('2'), [
      plugin('workflow-runs', 'a', ['workflow-transition'], { run: '1' }),
      plugin('unused-provider', 'b', ['specification-authority'], { state: '1' }),
    ]);

    expect(
      compareCompositions(before, after, {
        pluginIds: ['workflow-runs'],
        authorities: ['workflow-transition'],
      }),
    ).toMatchObject({ status: 'compatible', changedPluginIds: [] });
  });

  it('accepts an exact predecessor declaration for a protected compatible patch', () => {
    const beforePlugin = plugin('workflow-runs', 'a', ['workflow-transition'], { run: '1' });
    const afterPlugin = plugin('workflow-runs', 'b', ['workflow-transition'], { run: '1' }, [
      { codeDigest: beforePlugin.codeDigest, descriptorDigest: beforePlugin.descriptorDigest },
    ]);
    expect(
      compareCompositions(
        composition(digest('1'), [beforePlugin]),
        composition(digest('2'), [afterPlugin]),
      ),
    ).toMatchObject({ status: 'compatible', changedPluginIds: ['workflow-runs'] });
  });

  it('rejects a compatibility declaration that does not match the exact predecessor', () => {
    const beforePlugin = plugin('workflow-runs', 'a', ['workflow-transition'], { run: '1' });
    const afterPlugin = plugin('workflow-runs', 'b', ['workflow-transition'], { run: '1' }, [
      { codeDigest: digest('c'), descriptorDigest: beforePlugin.descriptorDigest },
    ]);
    expect(
      compareCompositions(
        composition(digest('1'), [beforePlugin]),
        composition(digest('2'), [afterPlugin]),
      ),
    ).toMatchObject({ status: 'migration_required' });
  });

  it('rejects adoption when the Runtime configuration identity changed', () => {
    const beforePlugin = plugin('workflow-runs', 'a', ['workflow-transition'], { run: '1' });
    const afterPlugin = {
      ...plugin('workflow-runs', 'b', ['workflow-transition'], { run: '1' }, [
        { codeDigest: beforePlugin.codeDigest, descriptorDigest: beforePlugin.descriptorDigest },
      ]),
      configDigest: digest('f'),
    };
    expect(
      compareCompositions(
        composition(digest('1'), [beforePlugin]),
        composition(digest('2'), [afterPlugin]),
      ),
    ).toMatchObject({ status: 'migration_required' });
  });

  it('rejects multi-predecessor adoption for a protected checkpoint dependency', () => {
    const beforePlugin = plugin('workflow-runs', 'a', ['workflow-transition'], { run: '1' });
    const afterPlugin = plugin('workflow-runs', 'b', ['workflow-transition'], { run: '1' }, [
      { codeDigest: beforePlugin.codeDigest, descriptorDigest: beforePlugin.descriptorDigest },
      { codeDigest: digest('c'), descriptorDigest: digest('d') },
    ]);
    expect(
      compareCompositions(
        composition(digest('1'), [beforePlugin]),
        composition(digest('2'), [afterPlugin]),
      ),
    ).toMatchObject({ status: 'migration_required' });
  });

  it('limits protected self-hosting adoption to the active Run direct predecessor', async () => {
    const catalog = await createRepoctopusBuiltinCatalog(path.resolve(import.meta.dirname, '..'));
    const expected = new Map([
      [
        'workflow-runs',
        {
          codeDigest: 'sha256:9da4dbb9040aa152848323ab5acb5c2be5441bb220ec31858a040867bf241183',
          descriptorDigest:
            'sha256:ff6451f1c2c5dd9fbf711cb487b1c256d2b5782099c75743966deb2af1653818',
        },
      ],
      [
        'managed-work-executor',
        {
          codeDigest: 'sha256:c38a70dc4a63da197f47f52a9c9e444394ed144fa43d9d84245c3e533dc2b028',
          descriptorDigest:
            'sha256:d7802dbbc31c42eacff6c200254b6873735978d9bf5cd4905338cd1b9b9f6375',
        },
      ],
      [
        'lifecycle-definition-builtin',
        {
          codeDigest: 'sha256:d87d3d92a1e86aa55072bb289a1c1292ca499d092f85ee6e6df4348edd578413',
          descriptorDigest:
            'sha256:b5de20ca5e52a5ec99cf1f6a02cf4d3705360c95fd176ad692ace94b5723c161',
        },
      ],
      [
        'lifecycle-validator-builtin',
        {
          codeDigest: 'sha256:fcd874bea2ec44fe16e58ea2628017ba3a614ee54ce95bcf9e339c817f90f09f',
          descriptorDigest:
            'sha256:fb3edf9da190de8f6a459a2c975874bc453ee3fde8e52f57fd234b4316fb18e7',
        },
      ],
      [
        'lifecycle-extension-builtin',
        {
          codeDigest: 'sha256:f0ef03c66bb3ee2e51ac910a1ad0071674044d0afb1f5724670c5054fd50a02a',
          descriptorDigest:
            'sha256:27231ac5e21cddddf63064ef5a4125fc274f15ddb10b71c4d8190cf892842d40',
        },
      ],
    ]);

    for (const [pluginId, predecessor] of expected) {
      expect(catalog.get(pluginId)?.descriptor.compatibleImplementations).toEqual([predecessor]);
    }
  });
});
