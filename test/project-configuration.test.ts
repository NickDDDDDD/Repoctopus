import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  parseLocalProjectConfig,
  parseSharedProjectConfig,
} from '../domains/project-configuration/config.js';

async function fixture(): Promise<Record<string, unknown>> {
  return parse(
    await readFile(
      path.join(import.meta.dirname, 'fixtures', 'project-config', 'self-hosted-valid.yaml'),
      'utf8',
    ),
  ) as Record<string, unknown>;
}

describe('project configuration', () => {
  it('keeps the GitHub credential with Delivery publication', async () => {
    const config = parseSharedProjectConfig(await fixture());
    expect(config.delivery?.publication.apiCredential).toEqual({
      provider: 'environment',
      variable: 'REPOCTOPUS_GITHUB_TOKEN',
    });
  });

  it.each(['platformEvents', 'postMerge'])(
    'rejects removed %s configuration with a migration diagnostic',
    async (field) => {
      const input = await fixture();
      input[field] = {};
      expect(() => parseSharedProjectConfig(input)).toThrow(new RegExp(`${field}.*removed`, 'i'));
    },
  );

  it('rejects raw Delivery credentials', async () => {
    const input = await fixture();
    const publication = (input.delivery as { publication: Record<string, unknown> }).publication;
    publication.apiCredential = 'secret';
    expect(() => parseSharedProjectConfig(input)).toThrow(/publication\.apiCredential/i);
  });

  it('parses strict Acceptance coverage selectors and includes them in configuration', async () => {
    const input = await fixture();
    const node = (input.profiles as Array<{ nodes: Array<Record<string, unknown>> }>)[0]!.nodes[0]!;
    node.covers = ['*', 'task:1.2', 'requirement:evidence#trace'];
    expect(parseSharedProjectConfig(input).profiles[0]?.nodes[0]?.covers).toEqual(node.covers);

    for (const invalid of [[''], ['task:abc'], ['*', '*']]) {
      node.covers = invalid;
      expect(() => parseSharedProjectConfig(input)).toThrow(
        /covers.*(?:non-empty|invalid|duplicate)/iu,
      );
    }
  });

  it('parses versioned team Skill bindings from shared lifecycle configuration', async () => {
    const input = await fixture();
    input.lifecycle = {
      skillBindings: {
        schemaVersion: 1,
        bindings: [
          {
            id: 'team-design-guidance',
            target: 'specification.plan',
            role: 'guidance',
            skill: 'team-code-guidance',
            order: 20,
          },
          {
            id: 'team-design-method',
            target: 'specification.plan',
            role: 'augmentation-replacement',
            skill: 'team-codebase-design',
            slot: 'design-method',
            order: 10,
          },
        ],
      },
    };

    expect(parseSharedProjectConfig(input).lifecycle).toEqual(input.lifecycle);
  });

  it.each([
    {
      label: 'required checks before their dedicated change',
      binding: {
        id: 'license-check',
        target: 'build.check',
        role: 'required-check',
        skill: 'license-check',
        order: 10,
      },
    },
    {
      label: 'module paths',
      binding: {
        id: 'arbitrary-module',
        target: 'specification.plan',
        role: 'guidance',
        skill: 'team-guidance',
        order: 10,
        module: './execute.js',
      },
    },
    {
      label: 'replacement without an explicit slot',
      binding: {
        id: 'implicit-replacement',
        target: 'specification.plan',
        role: 'augmentation-replacement',
        skill: 'team-codebase-design',
        order: 10,
      },
    },
  ])('rejects unsupported team Skill binding input: $label', async ({ binding }) => {
    const input = await fixture();
    input.lifecycle = {
      skillBindings: { schemaVersion: 1, bindings: [binding] },
    };

    expect(() => parseSharedProjectConfig(input)).toThrow(/lifecycle\.skillBindings/iu);
  });

  it('forbids local configuration from changing the shared team Skill composition', () => {
    expect(() =>
      parseLocalProjectConfig({
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'RepoctopusLocal',
        lifecycle: { skillBindings: { schemaVersion: 1, bindings: [] } },
      }),
    ).toThrow(/unknown field.*lifecycle|lifecycle.*unknown field/iu);
  });
});
