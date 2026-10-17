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
