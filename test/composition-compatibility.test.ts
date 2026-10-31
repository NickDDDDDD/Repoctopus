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
          codeDigest: 'sha256:813eeece9d54323afbc72b2e99ba7b7899a10f7cad9ab506e7551adc12d6a860',
          descriptorDigest:
            'sha256:7d6d0eb8c3ff06bbb2b86e14c004625b047ff2ea9dbfa946878a4db9eb38b0ce',
        },
      ],
      [
        'managed-work-executor',
        {
          codeDigest: 'sha256:864cd1727e33214c9bfa6c748c75e91f6faaf2f5d89ed2dc73278dfde8fb0a63',
          descriptorDigest:
            'sha256:5882235cb7dc97cf8d7cc225c78504f13d7859a57c1b5f2ad7cd334357aa0619',
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
          codeDigest: 'sha256:1ddbda5413183c53a569109426b52101c7b11a81b078796375cebd7ed592ec64',
          descriptorDigest:
            'sha256:717cb188db5e3b6d0112b711a840a220d59a003b2528758ce71c7365cc90a2eb',
        },
      ],
      [
        'lifecycle-extension-builtin',
        {
          codeDigest: 'sha256:999c22698474db633b225ea62d05eb5216930ac40c87f59b954cbcc353bd3d19',
          descriptorDigest:
            'sha256:b7d4c5d962c61768e4de0da74bde5faf7ff607018cb91df25f34b2ed43318fce',
        },
      ],
    ]);

    for (const [pluginId, predecessor] of expected) {
      expect(catalog.get(pluginId)?.descriptor.compatibleImplementations).toEqual([predecessor]);
    }
  });
});
