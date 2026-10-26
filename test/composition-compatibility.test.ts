import { describe, expect, it } from 'vitest';

import { compareCompositions } from '../domains/composition/compatibility.js';
import type {
  CompositionIdentitySnapshot,
  PluginImplementationIdentity,
} from '../domains/composition/types.js';

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
});
