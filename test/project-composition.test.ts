import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { compileProjectComposition } from '../app/boot/project-composition.js';
import { compositionIdentity } from '../app/boot/composition.js';
import { createRepoctopusBuiltinCatalog } from '../plugins/builtin-catalog.js';
import {
  loadProjectConfig,
  projectExecutionConfigDigests,
} from '../platform/project-configuration/file-config.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

describe('project composition assembly', () => {
  it('contains the short-lived archive services and no daemon infrastructure', async () => {
    const workspaceRoot = await temporaryDirectory('repoctopus-project-composition-');
    cleanup.push(workspaceRoot);
    await writeFile(
      path.join(workspaceRoot, 'repoctopus.yaml'),
      await readFile(
        path.join(import.meta.dirname, 'fixtures', 'project-config', 'self-hosted-valid.yaml'),
        'utf8',
      ),
    );
    const config = await loadProjectConfig(workspaceRoot);
    const composition = compileProjectComposition(
      path.resolve(import.meta.dirname, '..'),
      workspaceRoot,
      config,
      await createRepoctopusBuiltinCatalog(path.resolve(import.meta.dirname, '..')),
    );
    const ids = composition.entries.map((entry) => entry.id);
    expect(compositionIdentity(composition).compositionDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    const shared = { ...config.shared, profiles: [] };
    const withoutProfiles = compileProjectComposition(
      path.resolve(import.meta.dirname, '..'),
      workspaceRoot,
      { ...config, shared, ...projectExecutionConfigDigests(shared, config.local) },
      await createRepoctopusBuiltinCatalog(path.resolve(import.meta.dirname, '..')),
    );
    expect(compositionIdentity(withoutProfiles)).toEqual(compositionIdentity(composition));
    expect(ids).toEqual(
      expect.arrayContaining([
        'workflow-runs',
        'delivery-file',
        'specification-openspec',
        'consistency-reconciler',
        'desktop-instance-probe',
        'desktop-launcher',
        'observation-delivery',
        'repository-input-policies',
        'repository-input-policy-host',
        'team-skill-composition',
      ]),
    );
    for (const forbidden of [
      'http-host',
      'platform-event-runner',
      'runner-application',
      'post-merge-coordinator',
      'lifecycle-human-decisions',
    ]) {
      expect(ids).not.toContain(forbidden);
    }
    const desktopLauncher = composition.entries.find((entry) => entry.id === 'desktop-launcher');
    expect(desktopLauncher?.config).toEqual({
      productRoot: path.resolve(import.meta.dirname, '..'),
    });
    expect(desktopLauncher?.identityConfig).toEqual({
      productRoot: '@repoctopus/product-root',
    });
    const launcherIdentity = compositionIdentity(composition).plugins.find(
      (plugin) => plugin.id === 'desktop-launcher',
    );
    expect(JSON.stringify(launcherIdentity)).not.toContain(path.resolve(import.meta.dirname, '..'));
    const teamComposition = composition.entries.find(
      (entry) => entry.id === 'team-skill-composition',
    );
    expect(teamComposition?.config).toEqual({ workspaceRoot, bindings: [] });
    expect(teamComposition?.identityConfig).toEqual({
      workspaceRoot: '@repoctopus/workspace-root',
      bindings: [],
    });
  });
});
