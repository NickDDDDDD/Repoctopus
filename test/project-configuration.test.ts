import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  hashProjectConfig,
  parseLocalProjectConfig,
  parseSharedProjectConfig,
} from '../domains/project-configuration/config.js';
import type { SharedProjectConfig } from '../domains/project-configuration/types.js';
import { loadProjectConfig } from '../platform/project-configuration/file-config.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

async function configurationFixture(name: string): Promise<unknown> {
  return parse(
    await readFile(path.join(import.meta.dirname, 'fixtures', 'project-config', name), 'utf8'),
  ) as unknown;
}

interface SelfHostedFixture {
  postMerge: {
    runnerIdentity: string;
    evidenceProfile: string;
    allowedWorkspacePaths: { verificationPathPrefixes: string[] };
    publication: {
      operations: string[];
      commit: { authorNameCredential: unknown; authorEmailCredential: unknown };
    };
  };
  platformEvents: {
    github: { webhookCredential: unknown; apiCredential: unknown };
    runner: { identity: string };
  };
}

function shared(pathValue = '../service'): SharedProjectConfig {
  return parseSharedProjectConfig({
    apiVersion: 'repoctopus/v1alpha1',
    kind: 'RepoctopusWorkspace',
    workspace: { id: 'sample', repositoryId: 'workspace' },
    repositories: [
      { id: 'workspace', path: '.' },
      { id: 'service', path: pathValue },
    ],
    profiles: [
      {
        id: 'verify',
        nodes: [
          {
            id: 'build',
            type: 'command',
            repository: 'service',
            executable: 'npm',
            args: ['run', 'build'],
          },
        ],
      },
    ],
  });
}

describe('project configuration', () => {
  it('requires the Workspace Repository to be registered at the config root', () => {
    const missing = structuredClone(shared()) as unknown as Record<string, unknown>;
    missing.workspace = { id: 'sample', repositoryId: 'missing' };
    expect(() => parseSharedProjectConfig(missing)).toThrow(
      /workspace\.repositoryId: must reference a registered repository/i,
    );

    const outside = structuredClone(shared());
    outside.repositories = outside.repositories.map((repository) =>
      repository.id === outside.workspace.repositoryId
        ? { ...repository, path: '../workspace' }
        : repository,
    );
    expect(() => parseSharedProjectConfig(outside)).toThrow(
      /Workspace Repository path must be \./i,
    );
  });

  it('accepts self-hosted Provider, event Runner, Credential, and post-merge references', async () => {
    const config = parseSharedProjectConfig(await configurationFixture('self-hosted-valid.yaml'));

    expect(config.skillProviders?.map((provider) => provider.id)).toEqual([
      'skill-provider-matt',
      'skill-provider-filesystem',
    ]);
    expect(config.specificationProvider?.id).toBe('specification-openspec');
    expect(config.platformEvents?.github.webhookCredential).toEqual({
      provider: 'environment',
      variable: 'REPOCTOPUS_GITHUB_WEBHOOK_SECRET',
    });
    expect(config.postMerge?.allowedWorkspacePaths).toEqual({
      specificationClosure: true,
      verificationPathPrefixes: ['verification/post-merge/'],
    });
  });

  it('rejects raw platform secrets instead of treating them as Credential references', async () => {
    const fixture = await configurationFixture('self-hosted-raw-secret.yaml');
    expect(() => parseSharedProjectConfig(fixture)).toThrow(
      /platformEvents\.github\.webhookCredential: expected an object/i,
    );
  });

  it('requires every platform and machine identity value to use a Credential reference', async () => {
    const platform = (await configurationFixture('self-hosted-valid.yaml')) as SelfHostedFixture;
    platform.platformEvents.github.apiCredential = 'raw-platform-token';
    expect(() => parseSharedProjectConfig(platform)).toThrow(
      /platformEvents\.github\.apiCredential: expected an object/i,
    );

    const author = (await configurationFixture('self-hosted-valid.yaml')) as SelfHostedFixture;
    author.postMerge.publication.commit.authorEmailCredential = 'bot@example.test';
    expect(() => parseSharedProjectConfig(author)).toThrow(
      /postMerge\.publication\.commit\.authorEmailCredential: expected an object/i,
    );
  });

  it('rejects post-merge allowlists that collapse to the project root', async () => {
    const fixture = await configurationFixture('self-hosted-root-allowlist.yaml');
    expect(() => parseSharedProjectConfig(fixture)).toThrow(
      /concrete project-relative directory below the project root/i,
    );
  });

  it.each(['/', './', '**/', 'verification/', 'C:\\workspace\\'])(
    'rejects unsafe post-merge verification prefix %s',
    async (prefix) => {
      const fixture = (await configurationFixture('self-hosted-valid.yaml')) as SelfHostedFixture;
      fixture.postMerge.allowedWorkspacePaths.verificationPathPrefixes = [prefix];
      expect(() => parseSharedProjectConfig(fixture)).toThrow(
        /concrete project-relative directory below the project root/i,
      );
    },
  );

  it('rejects verification allowlists nested below a business source root', async () => {
    const fixture = (await configurationFixture('self-hosted-valid.yaml')) as SelfHostedFixture;
    fixture.postMerge.allowedWorkspacePaths.verificationPathPrefixes = ['services/verification/'];
    expect(() => parseSharedProjectConfig(fixture)).toThrow(
      /Verification path prefixes must identify a verification directory/i,
    );
  });

  it('rejects post-merge publication capabilities beyond the fixed protected set', async () => {
    const fixture = (await configurationFixture('self-hosted-valid.yaml')) as SelfHostedFixture;
    fixture.postMerge.publication.operations.push('merge');
    expect(() => parseSharedProjectConfig(fixture)).toThrow(
      /must contain only commit, push, and merge_request\.update/i,
    );
  });

  it('requires post-merge to reference the configured Runner and Evidence profile', async () => {
    const fixture = (await configurationFixture('self-hosted-valid.yaml')) as SelfHostedFixture;
    fixture.postMerge.runnerIdentity = 'different-runner';
    expect(() => parseSharedProjectConfig(fixture)).toThrow(
      /postMerge\.runnerIdentity: must reference platformEvents\.runner\.identity/i,
    );

    fixture.postMerge.runnerIdentity = fixture.platformEvents.runner.identity;
    fixture.postMerge.evidenceProfile = 'missing-profile';
    expect(() => parseSharedProjectConfig(fixture)).toThrow(
      /postMerge\.evidenceProfile: must reference an existing Evidence profile/i,
    );
  });

  it('rejects a post-merge Runner reference when platform events are not configured', async () => {
    const fixture = (await configurationFixture('self-hosted-valid.yaml')) as Record<
      string,
      unknown
    >;
    delete fixture.platformEvents;
    expect(() => parseSharedProjectConfig(fixture)).toThrow(
      /postMerge\.runnerIdentity: requires platformEvents Runner configuration/i,
    );
  });

  it('rejects post-merge publication without a shared Delivery policy', async () => {
    const fixture = (await configurationFixture('self-hosted-valid.yaml')) as Record<
      string,
      unknown
    >;
    delete fixture.delivery;
    expect(() => parseSharedProjectConfig(fixture)).toThrow(
      /postMerge\.publication: requires a shared Delivery policy/i,
    );
  });

  it('parses command, service, browser and visual nodes from one shared profile', () => {
    const config = parseSharedProjectConfig({
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'RepoctopusWorkspace',
      workspace: { id: 'full-feedback', repositoryId: 'workspace' },
      repositories: [
        { id: 'workspace', path: '.' },
        { id: 'app', path: '../app' },
      ],
      profiles: [
        {
          id: 'verify',
          nodes: [
            { id: 'build', type: 'command', repository: 'app', executable: 'npm', args: ['test'] },
            {
              id: 'serve',
              type: 'service',
              mode: 'managed',
              repository: 'app',
              dependsOn: ['build'],
              executable: 'npm',
              args: ['run', 'dev'],
              readiness: [
                { type: 'http', url: 'http://127.0.0.1:4173/health', statusCodes: [200] },
              ],
            },
            {
              id: 'browser',
              type: 'browser',
              repository: 'app',
              dependsOn: ['serve'],
              source: 'managed',
              journey: {
                apiVersion: 'repoctopus/v1alpha1',
                kind: 'BrowserJourney',
                journeyId: 'desktop',
                viewport: { width: 1280, height: 720 },
                timeoutMs: 1000,
                actions: [{ type: 'screenshot', name: 'dashboard' }],
              },
            },
            {
              id: 'visual',
              type: 'visual',
              repository: 'app',
              dependsOn: ['browser'],
              changeId: 'change',
              browserNode: 'browser',
              pageUrl: 'http://127.0.0.1:4173',
              criteria: [{ id: 'layout', text: 'Dashboard is visible' }],
            },
          ],
        },
      ],
    });
    expect(config.profiles[0]?.nodes.map((node) => node.type)).toEqual([
      'command',
      'service',
      'browser',
      'visual',
    ]);
  });

  it('normalizes path separators before hashing', () => {
    expect(hashProjectConfig(shared('..\\service\\'))).toBe(
      hashProjectConfig(shared('../service/')),
    );
  });

  it('rejects local fields that could weaken shared gates', () => {
    expect(() =>
      parseLocalProjectConfig({
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'RepoctopusLocal',
        required: false,
      }),
    ).toThrow(/unknown fields: required/i);
  });

  it('accepts only declarative shared team plugin entries', () => {
    const config = parseSharedProjectConfig({
      ...shared(),
      composition: {
        plugins: [
          {
            id: 'team-reporter',
            descriptor: '.repoctopus/plugins/team-reporter.json',
            module: '.repoctopus/plugins/team-reporter.mjs',
            config: { channel: 'audit' },
          },
        ],
      },
    });
    expect(config.composition?.plugins[0]).toMatchObject({ id: 'team-reporter' });
    expect(() =>
      parseLocalProjectConfig({
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'RepoctopusLocal',
        composition: { plugins: [] },
      }),
    ).toThrow(/unknown fields: composition/i);
  });

  it('accepts a machine-local visual exchange without adding it to shared config', () => {
    expect(
      parseLocalProjectConfig({
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'RepoctopusLocal',
        visual: {
          exchangeDirectory: '.repoctopus/visual-exchange',
          responseTimeoutMs: 120000,
        },
      }).visual,
    ).toEqual({
      exchangeDirectory: '.repoctopus/visual-exchange',
      responseTimeoutMs: 120000,
    });
  });

  it('loads a local repository path without changing the shared config', async () => {
    const workspace = await temporaryDirectory('repoctopus-config-');
    cleanup.push(workspace);
    await mkdir(path.join(workspace, '.repoctopus'), { recursive: true });
    await writeFile(
      path.join(workspace, 'repoctopus.yaml'),
      `apiVersion: repoctopus/v1alpha1
kind: RepoctopusWorkspace
workspace:
  id: sample
  repositoryId: workspace
repositories:
  - id: workspace
    path: .
  - id: service
    path: ../service
profiles:
  - id: verify
    nodes:
      - id: build
        type: command
        repository: service
        executable: npm
        args: [run, build]
`,
    );
    await writeFile(
      path.join(workspace, '.repoctopus', 'local.yaml'),
      `apiVersion: repoctopus/v1alpha1
kind: RepoctopusLocal
repositoryPaths:
  service: ./local-service
`,
    );

    const loaded = await loadProjectConfig(workspace);
    expect(loaded.shared.repositories.find((item) => item.id === 'service')?.path).toBe(
      '../service',
    );
    expect(loaded.repositories.find((item) => item.id === 'service')?.resolvedPath).toBe(
      path.join(workspace, 'local-service'),
    );
    expect(loaded.sharedDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(loaded.localDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(loaded.effectiveDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a local override for the Workspace Repository', async () => {
    const workspace = await temporaryDirectory('repoctopus-workspace-override-');
    cleanup.push(workspace);
    await mkdir(path.join(workspace, '.repoctopus'), { recursive: true });
    await writeFile(path.join(workspace, 'repoctopus.yaml'), JSON.stringify(shared()));
    await writeFile(
      path.join(workspace, '.repoctopus', 'local.yaml'),
      `apiVersion: repoctopus/v1alpha1
kind: RepoctopusLocal
repositoryPaths:
  workspace: ../other
`,
    );

    await expect(loadProjectConfig(workspace)).rejects.toThrow(
      /cannot override the Workspace Repository path/i,
    );
  });
});
