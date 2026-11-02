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
          codeDigest: 'sha256:2761b259f1c79963e2dab3eec81463feea5410fedd488969fab42888ab6bbd9e',
          descriptorDigest:
            'sha256:e67f69088fc94c7afbc408c0311e86f862bcfd966cc0c242e8b251119cdadac0',
        },
      ],
      [
        'delivery-file',
        {
          codeDigest: 'sha256:8ce1ca7a06353931b4dff6dd0a1f7fb45e0a5ef1bf119e4d4eb543a7a44dbb21',
          descriptorDigest:
            'sha256:621c769e571765974eade7280ef7dc5db2fcb5c6e6324f70d76dddac4e6bea7e',
        },
      ],
      [
        'work-execution-authority',
        {
          codeDigest: 'sha256:36a643951c7f65a120d0b178f71d47d0c90fa939dd05aab7178065381ad4dcba',
          descriptorDigest:
            'sha256:271b4e856d673159d55bf8108527e533caa353b0522b685aa5f662fb72c94b9d',
        },
      ],
      [
        'managed-work-executor',
        {
          codeDigest: 'sha256:c215f5216f9e445f7c672be6300b6dc0958d3de2b4b9ce35f0fd484228ece3e4',
          descriptorDigest:
            'sha256:e076b636b53139ca5d35745410c3bf40b06593f2eb28968730e5c489a080a361',
        },
      ],
      [
        'work-dispatcher',
        {
          codeDigest: 'sha256:8871a99bb63291306173606554b1e9fc6a019cd261159350dbc7af5aa44f7135',
          descriptorDigest:
            'sha256:9ea17bc9df73f75b5c596e19167b91d89438914b99e92350f434accd6f3924c0',
        },
      ],
      [
        'lifecycle-definition-builtin',
        {
          codeDigest: 'sha256:d98294bfc6c9c96b3071e2d1ef14a6ee86f16f30da82fa7b13afe7194620a6f6',
          descriptorDigest:
            'sha256:e8785c3e00e4b67dffe2f259598cbc4eb97fc87a7343ed45a9db9d713cd9f0bb',
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
