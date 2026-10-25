import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { Context } from '@deepseek-ai/cordis';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

import { bootApp, AppBootError } from '../app/boot/boot.js';
import { compileComposition } from '../app/boot/composition.js';
import { PLUGIN_CONTRACT_VERSION, type BuiltinPluginRegistration } from '../app/boot/descriptor.js';
import { createRepoctopusBuiltinCatalog } from '../plugins/builtin-catalog.js';
import { OpenSpecProvider } from '../platform/specification/openspec-provider.js';
import { GitSpecificationCheckoutManager } from '../platform/git/specification-checkout.js';
import {
  OpenSpecProcess,
  type SpecificationProcessPort,
} from '../platform/specification/openspec-process.js';
import { Specification, type SpecificationRoot } from '../services/specification.js';
import { assertSpecificationPlanningManifest } from '../domains/specification/planning-manifest.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

const productRoot = path.resolve(import.meta.dirname, '..');
const execFileAsync = promisify(execFile);
const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

async function write(relative: string, contents: string, root: string): Promise<void> {
  const file = path.join(root, ...relative.split('/'));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents);
}

async function commitFixture(root: string, message: string): Promise<void> {
  try {
    await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: root });
  } catch {
    await execFileAsync('git', ['init', '--initial-branch=main'], { cwd: root });
    await execFileAsync('git', ['config', 'user.name', 'Repoctopus Test'], { cwd: root });
    await execFileAsync('git', ['config', 'user.email', 'repoctopus@example.invalid'], {
      cwd: root,
    });
  }
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', message], { cwd: root });
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
  await write('openspec/changes/sample/.openspec.yaml', 'schema: spec-driven\n', root);
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
Define the stable demo behavior used to verify Specification Provider lifecycle operations.

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
  await commitFixture(root, 'fixture');
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
    const planningContext = await context.specification.planningContext('sample');
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
    expect(planningContext.artifacts).toHaveLength(4);
    expect(typeof planningContext.artifacts[0]?.instruction).toBe('string');
    expect(typeof planningContext.artifacts[0]?.template).toBe('string');
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
    const metadataFile = path.join(workspace, 'openspec', 'changes', 'sample', '.openspec.yaml');
    await writeFile(metadataFile, '# formatting noise\nschema: spec-driven\n');
    expect((await context.specification.planningManifest('sample')).semanticDigest).toBe(
      manifest.semanticDigest,
    );
    await writeFile(metadataFile, 'schema: spec-driven\nretire_capabilities: true\n');
    expect((await context.specification.planningManifest('sample')).semanticDigest).not.toBe(
      manifest.semanticDigest,
    );
    await writeFile(metadataFile, 'schema: spec-driven\n');
    const filesBeforeGuidance = (await readdir(workspace, { recursive: true })).sort();
    const guidance = await context.specification.planningGuidance('sample');
    expect(guidance.artifacts.map((artifact) => artifact.artifactKind)).toEqual([
      'proposal',
      'delta-specs',
      'design',
      'tasks',
    ]);
    expect(
      guidance.artifacts.find((artifact) => artifact.artifactKind === 'design')?.rules,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'design.public-test-seams' }),
        expect.objectContaining({ id: 'planning.synthesize-known-context' }),
      ]),
    );
    expect(guidance.artifacts.find((artifact) => artifact.artifactKind === 'tasks')?.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'tasks.tracer-bullet-slices' }),
        expect.objectContaining({ id: 'tasks.verifiable-acceptance' }),
        expect.objectContaining({ id: 'tasks.expand-contract-wide-refactors' }),
      ]),
    );
    expect(guidance.outputContract).toEqual({
      artifactKinds: ['proposal', 'delta-specs', 'design', 'tasks'],
      allowAdditionalPlanningArtifacts: false,
      trackerPublish: false,
    });
    const buildProtocol = await context.specification.phaseContext('build', 'sample');
    expect(buildProtocol.allowedOperations).toEqual([
      'inspect-change',
      'read-tasks',
      'complete-task-from-receipt',
    ]);
    expect(buildProtocol.artifacts.map((artifact) => artifact.id)).toEqual(['tasks']);
    expect(typeof buildProtocol.artifacts[0]?.instruction).toBe('string');
    expect(typeof buildProtocol.artifacts[0]?.template).toBe('string');
    const archiveProtocol = await context.specification.phaseContext('archive', 'sample');
    expect(archiveProtocol.artifacts.map((artifact) => artifact.id)).toEqual([
      'proposal',
      'specs',
      'design',
      'tasks',
    ]);
    expect((await readdir(workspace, { recursive: true })).sort()).toEqual(filesBeforeGuidance);
    expect(filesBeforeGuidance.some((file) => /(?:ticket|tracker)/iu.test(file))).toBe(false);
    const tasksFile = path.join(workspace, 'openspec', 'changes', 'sample', 'tasks.md');
    const originalTasks = await readFile(tasksFile, 'utf8');
    await writeFile(tasksFile, originalTasks.replace('- [x]', '- [ ]').replaceAll('\n', '\r\n'));
    expect((await context.specification.planningManifest('sample')).semanticDigest).toBe(
      manifest.semanticDigest,
    );
    const pendingTasks = await context.specification.tasks('sample');
    const firstCompletion = await context.specification.completeTask({
      changeId: 'sample',
      taskId: '1.1',
      taskRevision: pendingTasks.tasks[0]!.taskRevision,
      workId: 'build:1.1:runtime-receipt',
    });
    const replayCompletion = await context.specification.completeTask({
      changeId: 'sample',
      taskId: '1.1',
      taskRevision: pendingTasks.tasks[0]!.taskRevision,
      workId: 'build:1.1:runtime-receipt',
    });
    expect(firstCompletion).toMatchObject({ updated: true, taskId: '1.1' });
    expect(replayCompletion).toMatchObject({ updated: false, taskId: '1.1' });
    expect(await readFile(tasksFile, 'utf8')).toContain('- [x] 1.1 Complete fixture.');
    expect((await context.specification.tasks('sample')).tasks[0]?.completion).toEqual({
      source: 'runtime-work',
      workId: 'build:1.1:runtime-receipt',
    });
    await writeFile(
      tasksFile,
      originalTasks.replace('Complete fixture', 'Complete fixture safely'),
    );
    expect((await context.specification.planningManifest('sample')).semanticDigest).not.toBe(
      manifest.semanticDigest,
    );
    await writeFile(tasksFile, originalTasks);
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
    const archiveCheckout = await new GitSpecificationCheckoutManager(workspace).find(
      first.candidate.checkoutId,
    );
    expect(archiveCheckout).not.toBeNull();
    expect(
      await readFile(
        path.join(archiveCheckout!.root, 'openspec', 'specs', 'demo', 'spec.md'),
        'utf8',
      ),
    ).toContain('Added behavior');
    expect(
      await readFile(path.join(workspace, 'openspec', 'specs', 'demo', 'spec.md'), 'utf8'),
    ).not.toContain('Added behavior');
    expect(
      JSON.parse(
        await readFile(
          path.join(
            workspace,
            '.repoctopus',
            'specification',
            'closure-journals',
            `${plan.planDigest.slice('sha256:'.length)}.json`,
          ),
          'utf8',
        ),
      ),
    ).toMatchObject({ state: 'committed', resultClosureId: first.closureId });
    expect(
      await readdir(path.join(workspace, '.repoctopus', 'archive-checkouts')).catch(() => []),
    ).toEqual([first.candidate.checkoutId]);
    await context.fiber.dispose();
  }, 30_000);

  it('keeps a failed official archive candidate out of the developer working tree', async () => {
    const fixture = await openSpecFixture();
    const faultingProcess: SpecificationProcessPort = {
      async execute(args, options) {
        const result = await fixture.process.execute(args, options);
        if (args[0] === 'archive' && result.exitCode === 0) {
          await rm(path.join(options.cwd, 'openspec', 'specs', 'demo', 'spec.md'), {
            force: true,
          });
        }
        return result;
      },
    };
    const context = new Context();
    const fiber = context.plugin(OpenSpecProvider, {
      workspaceRoot: fixture.workspace,
      specificationRoot: fixture.specificationRoot,
      process: faultingProcess,
    });
    await fiber;
    const plan = await context.specification.prepareClosure({
      changeId: 'sample',
      mergeFactsDigest: `sha256:${'e'.repeat(64)}`,
      targetBaselineDigest: `sha256:${'f'.repeat(64)}`,
    });

    await expect(context.specification.close(plan)).rejects.toThrow(
      /Archived Specification is not valid/u,
    );
    expect(
      (
        await execFileAsync('git', ['status', '--porcelain=v1', '--', 'openspec'], {
          cwd: fixture.workspace,
        })
      ).stdout,
    ).toBe('');
    expect(
      JSON.parse(
        await readFile(
          path.join(
            fixture.workspace,
            '.repoctopus',
            'specification',
            'closure-journals',
            `${plan.planDigest.slice('sha256:'.length)}.json`,
          ),
          'utf8',
        ),
      ),
    ).toMatchObject({ state: 'applying', resultClosureId: null });
    expect(
      await readdir(path.join(fixture.workspace, '.repoctopus', 'archive-checkouts')),
    ).toHaveLength(1);
    await context.fiber.dispose();
  }, 30_000);

  it('replaces the OpenSpec archive placeholder with the Proposal purpose for a new capability', async () => {
    const fixture = await openSpecFixture();
    await write(
      'openspec/changes/add-fresh-capability/proposal.md',
      `# Change: add-fresh-capability

## Why
The fixture needs a fresh capability.

## What Changes
- Add the fresh capability.

## Capabilities

### New Capabilities
- \`fresh-capability\`: Define the fresh behavior owned by this capability.

## Impact
- Test fixture only.
`,
      fixture.workspace,
    );
    await write(
      'openspec/changes/add-fresh-capability/design.md',
      `# Design

## Context
The fixture creates one capability.

## Goals / Non-Goals

**Goals:**
- Add one requirement.

**Non-Goals:**
- Change another capability.

## Decisions
Use the official OpenSpec archive lifecycle.
`,
      fixture.workspace,
    );
    await write(
      'openspec/changes/add-fresh-capability/tasks.md',
      '# Tasks\n\n- [x] 1.1 Complete the fresh capability.\n',
      fixture.workspace,
    );
    await write(
      'openspec/changes/add-fresh-capability/specs/fresh-capability/spec.md',
      `# Fresh capability delta

## ADDED Requirements

### Requirement: Fresh behavior
The system MUST provide fresh behavior.

#### Scenario: Fresh action
- **WHEN** the fresh action runs
- **THEN** it succeeds
`,
      fixture.workspace,
    );
    await commitFixture(fixture.workspace, 'add fresh capability');
    const context = new Context();
    const fiber = context.plugin(OpenSpecProvider, {
      workspaceRoot: fixture.workspace,
      specificationRoot: fixture.specificationRoot,
      process: fixture.process,
    });
    await fiber;
    const plan = await context.specification.prepareClosure({
      changeId: 'add-fresh-capability',
      mergeFactsDigest: `sha256:${'c'.repeat(64)}`,
      targetBaselineDigest: `sha256:${'d'.repeat(64)}`,
    });

    const result = await context.specification.close(plan);
    const archiveCheckout = await new GitSpecificationCheckoutManager(fixture.workspace).find(
      result.candidate.checkoutId,
    );
    expect(archiveCheckout).not.toBeNull();
    expect(
      await readFile(
        path.join(archiveCheckout!.root, 'openspec', 'specs', 'fresh-capability', 'spec.md'),
        'utf8',
      ),
    ).toContain(
      '## Purpose\nDefine the fresh behavior owned by this capability.\n\n## Requirements',
    );
    await context.fiber.dispose();
  }, 30_000);

  it('validates an explicitly retired capability as absent instead of requiring its old spec', async () => {
    const fixture = await openSpecFixture();
    await write(
      'openspec/changes/retire-demo/.openspec.yaml',
      'schema: spec-driven\nretire_capabilities: true\n',
      fixture.workspace,
    );
    await write(
      'openspec/changes/retire-demo/proposal.md',
      `# Change: retire-demo

## Why
The demo capability is no longer part of the product.

## What Changes
- Remove the demo capability.

## Capabilities
- \`demo\`: retire the demo behavior.

## Impact
- Test fixture only.
`,
      fixture.workspace,
    );
    await write(
      'openspec/changes/retire-demo/design.md',
      `# Design

## Context
The fixture retires one capability.

## Goals / Non-Goals

**Goals:**
- Remove the capability specification.

**Non-Goals:**
- Add replacement behavior.

## Decisions
Use the official OpenSpec retirement metadata.
`,
      fixture.workspace,
    );
    await write(
      'openspec/changes/retire-demo/tasks.md',
      '# Tasks\n\n- [x] 1.1 Remove the demo implementation.\n',
      fixture.workspace,
    );
    await write(
      'openspec/changes/retire-demo/specs/demo/spec.md',
      `# Demo retirement

## REMOVED Requirements

### Requirement: Existing behavior

**Reason**: The demo capability is retired.

**Migration**: No replacement is required.
`,
      fixture.workspace,
    );
    await commitFixture(fixture.workspace, 'add capability retirement');
    const context = new Context();
    const fiber = context.plugin(OpenSpecProvider, {
      workspaceRoot: fixture.workspace,
      specificationRoot: fixture.specificationRoot,
      process: fixture.process,
    });
    await fiber;

    expect(await context.specification.inspect('retire-demo')).toMatchObject({
      affectedCapabilities: ['demo'],
      retiredCapabilities: ['demo'],
    });
    const plan = await context.specification.prepareClosure({
      changeId: 'retire-demo',
      mergeFactsDigest: `sha256:${'7'.repeat(64)}`,
      targetBaselineDigest: `sha256:${'8'.repeat(64)}`,
    });
    expect(plan.retiredCapabilities).toEqual(['demo']);
    const result = await context.specification.close(plan);
    const archiveCheckout = await new GitSpecificationCheckoutManager(fixture.workspace).find(
      result.candidate.checkoutId,
    );
    expect(archiveCheckout).not.toBeNull();
    await expect(
      readFile(path.join(archiveCheckout!.root, 'openspec', 'specs', 'demo', 'spec.md'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      readFile(path.join(fixture.workspace, 'openspec', 'specs', 'demo', 'spec.md'), 'utf8'),
    ).resolves.toContain('Existing behavior');
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
