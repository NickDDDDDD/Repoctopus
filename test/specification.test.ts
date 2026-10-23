import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Context } from '@deepseek-ai/cordis';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

import { bootApp, AppBootError } from '../app/boot/boot.js';
import { compileComposition } from '../app/boot/composition.js';
import { PLUGIN_CONTRACT_VERSION, type BuiltinPluginRegistration } from '../app/boot/descriptor.js';
import { createRepoctopusBuiltinCatalog } from '../plugins/builtin-catalog.js';
import { OpenSpecProvider } from '../platform/specification/openspec-provider.js';
import {
  OpenSpecProcess,
  type SpecificationProcessPort,
} from '../platform/specification/openspec-process.js';
import { Specification, type SpecificationRoot } from '../services/specification.js';
import { assertSpecificationPlanningManifest } from '../domains/specification/planning-manifest.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

const productRoot = path.resolve(import.meta.dirname, '..');
const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

async function write(relative: string, contents: string, root: string): Promise<void> {
  const file = path.join(root, ...relative.split('/'));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents);
}

interface OpenSpecFixture {
  workspace: string;
  process: OpenSpecProcess;
  specificationRoot: SpecificationRoot;
}

async function openSpecFixture(valid = true): Promise<OpenSpecFixture> {
  const root = await temporaryDirectory('repoctopus-specification-');
  const data = await temporaryDirectory('repoctopus-openspec-data-');
  const config = await temporaryDirectory('repoctopus-openspec-config-');
  cleanup.push(root);
  cleanup.push(data);
  cleanup.push(config);
  await write('openspec/config.yaml', 'schema: spec-driven\n', root);
  await mkdir(path.join(root, 'openspec', 'changes', 'archive'), { recursive: true });
  await write('.openspec-store/store.yaml', 'version: 1\nid: specification-test\n', root);
  await write(
    'openspec/stores/registry.yaml',
    stringify({
      version: 1,
      stores: {
        'specification-test': { backend: { type: 'git', local_path: root } },
      },
    }),
    data,
  );
  await write(
    'openspec/config.json',
    JSON.stringify({ defaultStore: 'must-not-override-explicit-store' }),
    config,
  );
  await write(
    'openspec/specs/demo/spec.md',
    `# Demo Specification

## Purpose
Demo capability.

## Requirements

### Requirement: Existing behavior
The system MUST preserve existing behavior.

#### Scenario: Existing action
- **WHEN** the existing action runs
- **THEN** it succeeds
`,
    root,
  );
  await write(
    'openspec/changes/sample/proposal.md',
    `# Change: sample

## Why
The fixture needs another behavior.

## What Changes
- Add another behavior.

## Capabilities
- \`demo\`: extend the demo capability.

## Impact
- Test fixture only.
`,
    root,
  );
  await write(
    'openspec/changes/sample/design.md',
    `# Design

## Context
The fixture extends one capability.

## Goals / Non-Goals

**Goals:**
- Add one requirement.

**Non-Goals:**
- Change runtime behavior.

## Decisions
Use the official OpenSpec lifecycle.
`,
    root,
  );
  await write('openspec/changes/sample/tasks.md', '# Tasks\n\n- [x] 1.1 Complete fixture.\n', root);
  await write(
    'openspec/changes/sample/specs/demo/spec.md',
    valid
      ? `# Spec Delta

## ADDED Requirements

### Requirement: Added behavior
The system MUST add behavior.

#### Scenario: Added action
- **WHEN** the new action runs
- **THEN** it succeeds
`
      : '# Spec Delta\n\n## ADDED Requirements\n\nMissing requirement structure.\n',
    root,
  );
  return {
    workspace: root,
    process: new OpenSpecProcess(undefined, 60_000, 16 * 1024 * 1024, {
      XDG_DATA_HOME: data,
      XDG_CONFIG_HOME: config,
      OPENSPEC_NO_UPDATE_CHECK: '1',
      OPENSPEC_TELEMETRY: '0',
    }),
    specificationRoot: {
      schemaVersion: 1,
      kind: 'SpecificationRoot',
      storeId: 'specification-test',
      repositoryId: 'workspace',
    },
  };
}

describe('Specification authority', () => {
  it('ignores undeclared implementation notes instead of inventing a fifth OpenSpec artifact', async () => {
    const process: SpecificationProcessPort = {
      execute(args) {
        if (args[0] === 'context') {
          return Promise.resolve({
            exitCode: 0,
            stdout: JSON.stringify({
              root: { path: productRoot, source: 'store', store_id: 'repoctopus-test' },
              members: [],
              status: [],
            }),
            stderr: '',
          });
        }
        expect(args).toContain('--store');
        expect(args).toContain('repoctopus-test');
        if (args[0] === 'show') {
          return Promise.resolve({
            exitCode: 0,
            stdout: JSON.stringify({ id: 'sample', title: 'Sample', deltas: [] }),
            stderr: '',
          });
        }
        if (args[0] === 'status') {
          return Promise.resolve({
            exitCode: 0,
            stdout: JSON.stringify({
              isPlanningComplete: true,
              artifactPaths: {
                proposal: { existingOutputPaths: ['README.md'] },
                'implementation-notes': { existingOutputPaths: ['implementation-notes.md'] },
                verification: { existingOutputPaths: ['package.json'] },
              },
            }),
            stderr: '',
          });
        }
        return Promise.reject(new Error(`Unexpected OpenSpec command: ${args.join(' ')}`));
      },
    };
    const context = new Context();
    const fiber = context.plugin(OpenSpecProvider, {
      workspaceRoot: productRoot,
      specificationRoot: {
        schemaVersion: 1,
        kind: 'SpecificationRoot',
        storeId: 'repoctopus-test',
        repositoryId: 'workspace',
      },
      process,
    });
    await fiber;

    const inspected = await context.specification.inspect('sample');
    expect(inspected.artifacts.map((artifact) => artifact.id)).toEqual([
      'proposal',
      'verification',
    ]);
    await context.fiber.dispose();
  });

  it('maps the official OpenSpec lifecycle to stable inspect, validate, and idempotent close results', async () => {
    const fixture = await openSpecFixture();
    const workspace = fixture.workspace;
    const context = new Context();
    const fiber = context.plugin(OpenSpecProvider, {
      workspaceRoot: fixture.workspace,
      specificationRoot: fixture.specificationRoot,
      process: fixture.process,
    });
    await fiber;

    const inspected = await context.specification.inspect('sample');
    const instructions = await context.specification.planningInstructions('sample');
    expect(context.specification.root()).toEqual({
      schemaVersion: 1,
      kind: 'SpecificationRoot',
      storeId: 'specification-test',
      repositoryId: 'workspace',
    });
    expect(inspected).toMatchObject({
      apiVersion: 'repoctopus.specification/v1alpha1',
      changeId: 'sample',
      provider: { id: 'openspec', version: '1.14.3' },
      planningComplete: true,
      affectedCapabilities: ['demo'],
    });
    expect(inspected.artifacts.map((artifact) => artifact.kind)).toEqual([
      'design',
      'proposal',
      'delta-specs',
      'tasks',
    ]);
    expect(inspected.artifacts.every((artifact) => artifact.digest?.startsWith('sha256:'))).toBe(
      true,
    );
    expect(instructions).toMatchObject({
      schemaName: 'spec-driven',
      provider: { id: 'openspec', version: '1.14.3' },
    });
    expect(instructions.artifacts.map((artifact) => artifact.kind)).toEqual([
      'proposal',
      'delta-specs',
      'design',
      'tasks',
    ]);
    expect(instructions.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    const manifest = await context.specification.planningManifest('sample');
    expect(manifest).toMatchObject({
      kind: 'SpecificationPlanningManifest',
      change: {
        changeId: 'sample',
        provider: { id: 'openspec', version: '1.14.3' },
        affectedCapabilities: ['demo'],
      },
      specificationRoot: { storeId: 'specification-test', repositoryId: 'workspace' },
      schema: { schemaName: 'spec-driven' },
    });
    expect(manifest.change.artifacts.map((artifact) => artifact.kind)).toEqual([
      'delta-specs',
      'design',
      'proposal',
      'tasks',
    ]);
    expect(manifest.semanticDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(await context.specification.planningManifest('sample')).toEqual(manifest);
    expect(() => assertSpecificationPlanningManifest(manifest)).not.toThrow();
    expect(JSON.stringify(manifest)).not.toContain(workspace);
    expect(JSON.stringify(manifest)).not.toContain('openspec/changes');
    expect(await context.specification.validate('sample', { strict: true })).toMatchObject({
      valid: true,
      strict: true,
      diagnostics: [],
    });

    const plan = await context.specification.prepareClosure({
      changeId: 'sample',
      mergeFactsDigest: `sha256:${'a'.repeat(64)}`,
      targetBaselineDigest: `sha256:${'b'.repeat(64)}`,
    });
    const first = await context.specification.close(plan);
    const replay = await context.specification.close(plan);
    expect(replay).toEqual(first);
    expect(first.status).toBe('closed');
    expect(first.archiveId).toMatch(/^\d{4}-\d{2}-\d{2}-sample$/u);
    expect(first.changedFiles).toEqual(
      expect.arrayContaining([
        'openspec/specs/demo/spec.md',
        expect.stringMatching(/^openspec\/changes\/archive\/.+\/proposal\.md$/u),
      ]),
    );
    expect(
      await readFile(path.join(workspace, 'openspec', 'specs', 'demo', 'spec.md'), 'utf8'),
    ).toContain('Added behavior');
    await context.fiber.dispose();
  }, 30_000);

  it('returns normalized diagnostics for an invalid delta instead of treating process failure as success', async () => {
    const fixture = await openSpecFixture(false);
    const context = new Context();
    const fiber = context.plugin(OpenSpecProvider, {
      workspaceRoot: fixture.workspace,
      specificationRoot: fixture.specificationRoot,
      process: fixture.process,
    });
    await fiber;
    const result = await context.specification.validate('sample', { strict: true });
    expect(result.valid).toBe(false);
    expect(result.diagnostics).not.toHaveLength(0);
    await context.fiber.dispose();
  });

  it('fails closed for an unregistered Store instead of falling back to nearest or default roots', async () => {
    const fixture = await openSpecFixture();
    const context = new Context();
    const fiber = context.plugin(OpenSpecProvider, {
      workspaceRoot: fixture.workspace,
      specificationRoot: {
        ...fixture.specificationRoot,
        storeId: 'not-registered',
      },
      process: fixture.process,
    });
    await fiber;

    await expect(context.specification.inspect('sample')).rejects.toThrow(
      /Store not-registered is unavailable.*Unknown store/u,
    );
    await context.fiber.dispose();
  });

  it('fails closed when registry and Store metadata identify different stores', async () => {
    const fixture = await openSpecFixture();
    await write(
      '.openspec-store/store.yaml',
      'version: 1\nid: different-store\n',
      fixture.workspace,
    );
    const context = new Context();
    const fiber = context.plugin(OpenSpecProvider, {
      workspaceRoot: fixture.workspace,
      specificationRoot: fixture.specificationRoot,
      process: fixture.process,
    });
    await fiber;

    await expect(context.specification.inspect('sample')).rejects.toThrow(
      /Store specification-test is unavailable.*metadata id/u,
    );
    await context.fiber.dispose();
  });

  it('fails closed when the local registry points the Store id at another checkout', async () => {
    const fixture = await openSpecFixture();
    const wrongCheckout = path.join(fixture.workspace, 'wrong-checkout');
    await mkdir(wrongCheckout);
    const context = new Context();
    const fiber = context.plugin(OpenSpecProvider, {
      workspaceRoot: wrongCheckout,
      specificationRoot: fixture.specificationRoot,
      process: fixture.process,
    });
    await fiber;

    await expect(context.specification.inspect('sample')).rejects.toThrow(
      /registered to a different checkout/u,
    );
    await context.fiber.dispose();
  });

  it('fails App Boot with zero or multiple authorities and starts with one authority', async () => {
    const fixture = await openSpecFixture();
    const workspace = fixture.workspace;
    const builtin = await createRepoctopusBuiltinCatalog(productRoot);
    const zero = compileComposition(
      { id: 'zero-spec', kind: 'project', plugins: [], requiredServices: ['specification'] },
      builtin,
    );
    await expect(bootApp({ composition: zero, catalog: builtin })).rejects.toBeInstanceOf(
      AppBootError,
    );

    const one = compileComposition(
      {
        id: 'one-spec',
        kind: 'project',
        plugins: [
          {
            id: 'specification-openspec',
            config: {
              workspaceRoot: workspace,
              specificationRoot: fixture.specificationRoot,
              process: fixture.process,
            },
          },
        ],
        requiredServices: ['specification'],
      },
      builtin,
    );
    const running = await bootApp({ composition: one, catalog: builtin });
    expect(running.context.specification.identity().id).toBe('openspec');
    await running.close();

    class DuplicateSpecification extends Specification {
      identity() {
        return {
          id: 'duplicate',
          version: '1.0.0',
          protocolVersion: 'repoctopus.specification/v1alpha1' as const,
        };
      }
      inspect(): never {
        throw new Error('unused');
      }
      validate(): never {
        throw new Error('unused');
      }
      prepareClosure(): never {
        throw new Error('unused');
      }
      close(): never {
        throw new Error('unused');
      }
    }
    const duplicate: BuiltinPluginRegistration = {
      descriptor: {
        id: 'specification-duplicate',
        version: '1.0.0',
        contractVersion: PLUGIN_CONTRACT_VERSION,
        configSchemaVersion: '1',
        kind: 'service-provider',
        source: 'builtin',
        codeDigest: `sha256:${'d'.repeat(64)}`,
        compositions: ['project'],
        authorities: ['specification-authority'],
        permissions: [],
        stateSchemas: {},
      },
      plugin: DuplicateSpecification,
    };
    const duplicateCatalog = new Map(builtin).set('specification-duplicate', duplicate);
    await expect(
      Promise.resolve().then(() =>
        compileComposition(
          {
            id: 'multiple-spec',
            kind: 'project',
            plugins: [
              {
                id: 'specification-openspec',
                config: {
                  workspaceRoot: workspace,
                  specificationRoot: fixture.specificationRoot,
                  process: fixture.process,
                },
              },
              { id: 'specification-duplicate' },
            ],
            requiredServices: ['specification'],
          },
          duplicateCatalog,
        ),
      ),
    ).rejects.toThrow('Authority specification-authority has multiple owners');
  });
});
