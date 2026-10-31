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

  it('limits protected self-hosting adoption to the active Run direct predecessor', async () => {
    const catalog = await createRepoctopusBuiltinCatalog(path.resolve(import.meta.dirname, '..'));
    const expected = new Map([
      [
        'workflow-runs',
        {
          codeDigest: 'sha256:24235a25f865ec4309b2967ff67cbb8aad7b8d563896b97bf3b311d26f814596',
          descriptorDigest:
            'sha256:7ad498f589335e914db2419a995c737619e02cdc1503d1c2d84b11e0c7872064',
        },
      ],
      [
        'managed-work-executor',
        {
          codeDigest: 'sha256:a3d18d9854d176ad2a88b8597dc3fa80b6e64ce68faefe1d83c09ae6af62a9ba',
          descriptorDigest:
            'sha256:4e5f48cad130c375be7acc2abdbf3ff67fd9659f11a06f0a62120218bf6865fa',
        },
      ],
      [
        'lifecycle-definition-builtin',
        {
          codeDigest: 'sha256:cbd905ece097359b2d0529c7bf65ae4e07c0df48b08761618a2efed71620441f',
          descriptorDigest:
            'sha256:c4f16b784d4f3d542e38eb5847fc3ca18d81afdc559a8de3aa6cab6aa64bca04',
        },
      ],
      [
        'lifecycle-validator-builtin',
        {
          codeDigest: 'sha256:4805d959c0b2e3732aa1daffcc689934a660ce226db7efc7a4d6f87cdfb688a0',
          descriptorDigest:
            'sha256:357249984ada9aae4b8f8f2df4373110570ce326991a33970876394f253917b1',
        },
      ],
      [
        'lifecycle-extension-builtin',
        {
          codeDigest: 'sha256:b29078511a9eff1f796513e755b006c65377e917dd6e3cf05b429db560ac0593',
          descriptorDigest:
            'sha256:25a81afeeff570caaa23f277244930e34d9037e1b913ecd267a737089e46f16a',
        },
      ],
    ]);

    for (const [pluginId, predecessor] of expected) {
      expect(catalog.get(pluginId)?.descriptor.compatibleImplementations).toEqual([predecessor]);
    }
  });
});
