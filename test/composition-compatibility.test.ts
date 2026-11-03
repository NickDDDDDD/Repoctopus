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
          codeDigest: 'sha256:ee93faeb562593e8201bf22b7b6869e265bc3f93bdee94b02696aa9ecf8e1425',
          descriptorDigest:
            'sha256:01a09bf58eeb16293a58bfc3b572696fd1063aee741ea5a8e816e4b810be9927',
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
          codeDigest: 'sha256:cf97d6949b11dcf5b9d4eb8c84a8962bf3aeae9d21675afb0497b1ca5889f74c',
          descriptorDigest:
            'sha256:eecfcc944df7ca93fde319036c6a3fe42a31f4c33e75d746ea3305144b7a2dee',
        },
      ],
      [
        'managed-work-executor',
        {
          codeDigest: 'sha256:b6c1c1a06f07f438192c24623a0c8ee5b7026703aa1b187aa2a7dc5322f3396f',
          descriptorDigest:
            'sha256:1484807be04f35293ac08ebbea0954fc99975f6c14509cf78a61e71c8b73f830',
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
          codeDigest: 'sha256:ad89f07de38386eba277c8f94dbf1dbc266bf34e31d24108962f726e495815e1',
          descriptorDigest:
            'sha256:a404e2fdd15791971f77456acd3d91969107621e3a510acff9ecc86c5d1950aa',
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
      [
        'execution-workspace-git',
        {
          codeDigest: 'sha256:a3f9fbd774e4b7ad13a874011331f69319db9acce58edc4ecbd1fcf697473c4f',
          descriptorDigest:
            'sha256:437c5b1befe64b8d8d1a9f49eb1d950217bc51a9d6cd7a8424841725d50ec8ff',
        },
      ],
      [
        'work-execution-packet-store-file',
        {
          codeDigest: 'sha256:b30981bc7faaf165355b4178366ccf06de0a0ba3a947e481849b64fedbe84ab0',
          descriptorDigest:
            'sha256:0afa27bbb7ed289817f2fd7cf0c5fadc18847774df28e42143015ea9bf4d0a05',
        },
      ],
      [
        'work-execution-hosts',
        {
          codeDigest: 'sha256:02025f31a26c6bbc9fd55fdf75d58e19ff7d43e907eb3b702ef8116975b06fe4',
          descriptorDigest:
            'sha256:0d197abb829997893bab869e96e4d1bbbc4902ddaeddddecb852dc301ca767aa',
        },
      ],
      [
        'work-execution-sessions',
        {
          codeDigest: 'sha256:02025f31a26c6bbc9fd55fdf75d58e19ff7d43e907eb3b702ef8116975b06fe4',
          descriptorDigest:
            'sha256:7a0c7292228b2a06c019eec92cf57d3109690e62951be89b5c54bdbf492706e9',
        },
      ],
    ]);

    for (const [pluginId, predecessor] of expected) {
      expect(catalog.get(pluginId)?.descriptor.compatibleImplementations).toEqual([predecessor]);
    }
  });
});
