import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { bootApp } from '../app/boot/boot.js';
import { bootBootstrapComposition, bootProjectComposition } from '../app/boot/bootstrap.js';
import { compositionIdentity, compileComposition } from '../app/boot/composition.js';
import {
  compileProjectComposition,
  compileRunnerComposition,
} from '../app/boot/project-composition.js';
import { compareCompositions } from '../domains/composition/compatibility.js';
import { createRepoctopusBuiltinCatalog } from '../plugins/builtin-catalog.js';
import { loadProjectConfig } from '../platform/project-configuration/file-config.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

const productRoot = path.resolve(import.meta.dirname, '..');
const cleanup: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(cleanup.splice(0).map(removeTemporaryDirectory));
});

async function selfHostedProject() {
  const workspaceRoot = await temporaryDirectory('repoctopus-project-composition-');
  cleanup.push(workspaceRoot);
  const fixture = await readFile(
    path.join(import.meta.dirname, 'fixtures', 'project-config', 'self-hosted-valid.yaml'),
    'utf8',
  );
  await writeFile(path.join(workspaceRoot, 'repoctopus.yaml'), fixture);
  return { workspaceRoot, config: await loadProjectConfig(workspaceRoot) };
}

describe('project composition assembly', () => {
  it('boots the production bootstrap and command project compositions', async () => {
    const { workspaceRoot } = await selfHostedProject();
    const bootstrap = await bootBootstrapComposition(productRoot);
    expect(bootstrap.composition.id).toBe('repoctopus-bootstrap');
    await bootstrap.close();

    const project = await bootProjectComposition(productRoot, workspaceRoot);
    expect(project.composition.id).toBe('repoctopus-project');
    expect(project.context.get('specification')).toBeDefined();
    await project.close();
  });

  it('keeps command boot lightweight and puts configured runtime plugins in the Runner digest', async () => {
    const { workspaceRoot, config } = await selfHostedProject();
    const catalog = await createRepoctopusBuiltinCatalog(productRoot);
    const project = compileProjectComposition(productRoot, workspaceRoot, config, catalog);
    const runner = compileRunnerComposition(productRoot, workspaceRoot, config, catalog);
    const projectIds = project.entries.map((entry) => entry.id);
    const runnerIds = runner.entries.map((entry) => entry.id);

    expect(projectIds).toEqual(
      expect.arrayContaining([
        'skill-provider-matt',
        'skill-provider-filesystem',
        'specification-openspec',
        'platform-events-file',
        'post-merge-coordinator',
        'post-merge-actions',
        'post-merge-command',
      ]),
    );
    expect(projectIds).not.toContain('http-host');
    expect(projectIds).not.toContain('github-webhook-route');
    expect(projectIds).not.toContain('platform-event-runner');
    expect(projectIds).not.toContain('runner-application');
    expect(runnerIds).toEqual(
      expect.arrayContaining([
        'http-host',
        'github-webhook-route',
        'platform-event-runner',
        'post-merge-coordinator',
        'github-post-merge-events',
        'post-merge-actions',
        'runner-application',
      ]),
    );
    expect(runner.entries.find((entry) => entry.id === 'runner-application')?.descriptor.kind).toBe(
      'application',
    );
    const postMergeActions = runner.entries.find((entry) => entry.id === 'post-merge-actions');
    expect(postMergeActions?.descriptor.configSchemaVersion).toBe('2');
    expect(postMergeActions?.config).toMatchObject({
      publication: {
        operations: ['merge_target', 'commit', 'push', 'merge_request.create_or_recover'],
        finalChangeMergeRequest: {
          title: 'Close verified specification',
          body: 'Post-merge verification and specification closure completed.',
        },
      },
    });
    expect(postMergeActions?.config).not.toHaveProperty('publication.changeMergeRequest');
    expect(runner.compositionDigest).not.toBe(project.compositionDigest);
  });

  it('keeps composition identity stable across equivalent product and Workspace locations', async () => {
    const first = await selfHostedProject();
    const second = await selfHostedProject();
    const catalog = await createRepoctopusBuiltinCatalog(productRoot);
    const firstComposition = compileProjectComposition(
      productRoot,
      first.workspaceRoot,
      first.config,
      catalog,
    );
    const secondComposition = compileProjectComposition(
      path.join(productRoot, 'alternate-install-location'),
      second.workspaceRoot,
      second.config,
      catalog,
    );

    expect(secondComposition.compositionDigest).toBe(firstComposition.compositionDigest);
    expect(compositionIdentity(secondComposition).plugins).toEqual(
      compositionIdentity(firstComposition).plugins,
    );
    expect(
      secondComposition.entries.find((entry) => entry.id === 'specification-openspec')?.config,
    ).toEqual({ workspaceRoot: second.workspaceRoot });
    expect(
      secondComposition.entries.find((entry) => entry.id === 'maintenance-command')?.config,
    ).toEqual({ productRoot: path.join(productRoot, 'alternate-install-location') });
  });

  it('fails closed when a configured Provider is not in the admitted catalog', async () => {
    const { workspaceRoot, config } = await selfHostedProject();
    const catalog = await createRepoctopusBuiltinCatalog(productRoot);
    config.shared.specificationProvider = { id: 'specification-missing' };

    expect(() => compileProjectComposition(productRoot, workspaceRoot, config, catalog)).toThrow(
      'Unknown plugin: specification-missing',
    );
  });

  it('reports the Runner Application as inactive when its service dependencies are absent', async () => {
    const catalog = await createRepoctopusBuiltinCatalog(productRoot);
    const composition = compileComposition(
      {
        id: 'runner-missing-dependencies',
        kind: 'project',
        plugins: [{ id: 'runner-application' }],
      },
      catalog,
    );

    await expect(bootApp({ composition, catalog })).rejects.toMatchObject({
      name: 'AppBootError',
      diagnostics: [
        expect.objectContaining({
          code: 'PLUGIN_NOT_ACTIVE',
          pluginId: 'runner-application',
        }),
      ],
    });
  });

  it('boots the configured Runner and unloads and reloads its Application Fiber', async () => {
    const { workspaceRoot, config } = await selfHostedProject();
    config.shared.platformEvents!.http.port = 0;
    vi.stubEnv('REPOCTOPUS_GIT_AUTHOR_NAME', 'Repoctopus Test');
    vi.stubEnv('REPOCTOPUS_GIT_AUTHOR_EMAIL', 'repoctopus@example.test');
    const catalog = await createRepoctopusBuiltinCatalog(productRoot);
    const composition = compileRunnerComposition(productRoot, workspaceRoot, config, catalog);
    const app = await bootApp({ composition, catalog });
    await app.context.httpHost.ready();
    expect(app.context.httpHost.origin()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
    expect(app.context.get('platformEventRunner')).toBeDefined();
    expect(app.context.get('postMergeCoordinator')).toBeDefined();
    expect(app.context.get('postMergeActions')).toBeDefined();

    const loaderEntries = composition.entries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      ...(entry.config === undefined ? {} : { config: entry.config }),
    }));
    await app.context.loader.root.update(
      loaderEntries.filter((entry) => entry.id !== 'runner-application'),
    );
    await app.context.loader.await();
    expect(() => app.context.loader.resolve('runner-application')).toThrow();

    await app.context.loader.root.update(loaderEntries);
    await app.context.loader.await();
    expect(app.context.loader.resolve('runner-application').fiber).toBeDefined();
    await app.close();
  });

  it('requires migration when a protected Post-merge implementation changes', async () => {
    const { workspaceRoot, config } = await selfHostedProject();
    const catalog = await createRepoctopusBuiltinCatalog(productRoot);
    const current = compositionIdentity(
      compileRunnerComposition(productRoot, workspaceRoot, config, catalog),
    );
    const changed = structuredClone(current);
    const coordinator = changed.plugins.find((plugin) => plugin.id === 'post-merge-coordinator')!;
    coordinator.codeDigest = `sha256:${'f'.repeat(64)}`;
    changed.compositionDigest = `sha256:${'e'.repeat(64)}`;

    expect(compareCompositions(current, changed)).toMatchObject({
      status: 'migration_required',
      changedPluginIds: ['post-merge-coordinator'],
    });
  });
});
