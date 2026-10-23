import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';

import { bootApp } from '../app/boot/boot.js';
import { bootBootstrapComposition } from '../app/boot/bootstrap.js';
import { compileComposition } from '../app/boot/composition.js';
import {
  createBuiltinCatalog,
  PLUGIN_CONTRACT_VERSION,
  type BuiltinPluginRegistration,
  type PluginKind,
} from '../app/boot/descriptor.js';
import projectProbeContributor from '../plugins/command/project-probe-contributor.js';
import { GitProjectProvider } from '../plugins/project/git-project-provider.js';
import { CommandRouter } from '../services/command-router.js';
import {
  createGitRepository,
  removeTemporaryDirectory,
  temporaryDirectory,
} from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

function registration(
  id: string,
  kind: PluginKind,
  plugin: BuiltinPluginRegistration['plugin'],
): BuiltinPluginRegistration {
  return {
    descriptor: {
      id,
      version: '1.0.0',
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind,
      source: 'builtin',
      codeDigest:
        `sha256:${id === 'command-router' ? 'a' : id === 'project-git' ? 'b' : 'c'.repeat(64)}`
          .replace('sha256:a', `sha256:${'a'.repeat(64)}`)
          .replace('sha256:b', `sha256:${'b'.repeat(64)}`) as `sha256:${string}`,
      compositions: ['bootstrap', 'project'],
      authorities: id === 'project-git' ? ['project-probe'] : [],
      permissions: id === 'project-git' ? ['filesystem', 'process'] : [],
      stateSchemas: {},
    },
    plugin,
  };
}

describe('Cordis product Service composition', () => {
  it('runs the real multi-repository probe through Provider, Contributor, Router, and App Boot', async () => {
    const root = await temporaryDirectory('repoctopus-service-composition-');
    cleanup.push(root);
    await createGitRepository(root, 'workspace');
    await createGitRepository(root, 'front');
    await createGitRepository(root, 'backend');

    const catalog = createBuiltinCatalog([
      registration('command-router', 'service-provider', CommandRouter),
      registration('project-git', 'service-provider', GitProjectProvider),
      registration('project-probe-command', 'contributor', projectProbeContributor),
    ]);
    const composition = compileComposition(
      {
        id: 'bootstrap',
        kind: 'bootstrap',
        plugins: [{ id: 'command-router' }, { id: 'project-git' }, { id: 'project-probe-command' }],
        requiredServices: ['commandRouter', 'project'],
      },
      catalog,
    );

    const app = await bootApp({ composition, catalog });
    expect(app.context.commandRouter.list()).toEqual(['project.probe', 'workspace.snapshot']);
    const result = await app.context.commandRouter.execute<
      { root: string },
      { repositories: { name: string }[] }
    >('project.probe', { root });

    expect(result.repositories.map((repository) => repository.name).sort()).toEqual([
      'backend',
      'front',
      'workspace',
    ]);
    await app.close();
    expect(app.context.get('commandRouter')).toBeUndefined();
    expect(app.context.get('project')).toBeUndefined();
  });

  it('boots the shipped bootstrap composition with source-derived plugin identities', async () => {
    const root = await temporaryDirectory('repoctopus-bootstrap-composition-');
    cleanup.push(root);
    await createGitRepository(root, 'workspace');
    await createGitRepository(root, 'front');

    const app = await bootBootstrapComposition(path.resolve(import.meta.dirname, '..'), root);
    const result = await app.context.commandRouter.execute<
      { root: string },
      { repositories: { name: string }[] }
    >('project.probe', { root });

    expect(result.repositories.map((repository) => repository.name)).toEqual([
      'front',
      'workspace',
    ]);
    expect(app.composition.compositionDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    await app.close();
  });
});
