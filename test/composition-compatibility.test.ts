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
        'action-manual',
        {
          codeDigest: 'sha256:8aa93effa7136d6ec4666e92ac196968750abaef7a14b2d5dbbcc064452486f8',
          descriptorDigest:
            'sha256:60335fd0b157c0c563527cd8f18db0ae48fdede38628edf9bb4c50894857fba2',
        },
      ],
      [
        'action-work-contributors',
        {
          codeDigest: 'sha256:eec329322b704c0332fac463f13e1e2904343f70a0b7f097cb5ca3614e8337d2',
          descriptorDigest:
            'sha256:7f96982ec70e6583f934bd964965510fd41547162a15414f71879a204a814873',
        },
      ],
      [
        'workflow-runs',
        {
          codeDigest: 'sha256:5cec3c3022b3f17125739492a4b823b4d22c87d0601f96effe554d99a6274455',
          descriptorDigest:
            'sha256:b688e2f1af6be41b4eb522eb2c0e63bd7c411d4ec12d2bd93bf64a41d9395818',
        },
      ],
      [
        'delivery-file',
        {
          codeDigest: 'sha256:be5891af24c9b1d0e978a1a83a0587f1bcb2edbbe6e8d5b2fbee3ba1996b71b9',
          descriptorDigest:
            'sha256:d1e88beb9de8336b33f4a5acd3c08c3ccb6547f5701dc7eba490cf5e132087a5',
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
          codeDigest: 'sha256:f239d96521377e144d893c165d85efe7eb8b59a5fdd01637141d0d07c8a7aa84',
          descriptorDigest:
            'sha256:5edb8b84214405f7da4a2b12198bc37f459e481dec25309bdb5551f4b82acc27',
        },
      ],
      [
        'lifecycle-validator-builtin',
        {
          codeDigest: 'sha256:23443ba7521fd4eb71ee6d7f24cd6c56c14e9d5a9fe45a20321606dcbbae7658',
          descriptorDigest:
            'sha256:24b5ca587fd1daca92e7a2c78c66d7b714a977791341c5ec03bbf9bc38643865',
        },
      ],
      [
        'lifecycle-extension-builtin',
        {
          codeDigest: 'sha256:c9d53821a48860893e6867fedd26a1c109dd22dabd6a28e687b3b6bca9cfc470',
          descriptorDigest:
            'sha256:215b1bb171dd66af4c739c6539079eb5dce05f70e1b7011adac342051b886d21',
        },
      ],
      [
        'execution-workspace-git',
        {
          codeDigest: 'sha256:2603045f12a8dafdb92ee7c241181895fc86393bec5a4ae8d6fe1fb5f3ef3711',
          descriptorDigest:
            'sha256:0f9d40de09141cc04363049f815ffdd946bd6a614af3caa10dc153d8d924f34a',
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
