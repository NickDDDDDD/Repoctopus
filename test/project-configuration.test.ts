import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

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

function shared(pathValue = '../service'): SharedProjectConfig {
  return parseSharedProjectConfig({
    apiVersion: 'repoctopus/v1alpha1',
    kind: 'RepoctopusProject',
    project: { id: 'sample' },
    repositories: [{ id: 'service', path: pathValue }],
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
  it('parses command, service, browser and visual nodes from one shared profile', () => {
    const config = parseSharedProjectConfig({
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'RepoctopusProject',
      project: { id: 'full-feedback' },
      repositories: [{ id: 'app', path: '../app' }],
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
kind: RepoctopusProject
project:
  id: sample
repositories:
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
    expect(loaded.shared.repositories[0]?.path).toBe('../service');
    expect(loaded.repositories[0]?.resolvedPath).toBe(path.join(workspace, 'local-service'));
    expect(loaded.sharedDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(loaded.localDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(loaded.effectiveDigest).toMatch(/^[0-9a-f]{64}$/);
  });
});
