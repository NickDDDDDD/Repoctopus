import { execFile } from 'node:child_process';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import type { MergeRequestPort } from '../domains/delivery/ports.js';
import type { MergeRequestIdentity } from '../domains/delivery/types.js';
import type { SpecificationClosureResult } from '../domains/specification/types.js';
import { SpecificationPublicationAdapter } from '../platform/delivery/specification-publication.js';
import {
  createGitRepository,
  removeTemporaryDirectory,
  temporaryDirectory,
} from './helpers/fixtures.js';

const execFileAsync = promisify(execFile);
const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

describe('Specification publication adapter', () => {
  it('publishes an archive move whose Receipt contains both rename identities', async () => {
    const root = await temporaryDirectory('repoctopus-specification-publication-');
    cleanup.push(root);
    const remote = path.join(root, 'remote.git');
    await mkdir(remote);
    await execFileAsync('git', ['init', '--bare'], { cwd: remote });
    const repository = await createGitRepository(root, 'workspace', remote);
    await execFileAsync('git', ['push', '-u', 'origin', 'main'], { cwd: repository });
    await execFileAsync('git', ['switch', '-c', 'spec/archive-move'], { cwd: repository });

    const active = 'openspec/changes/example/proposal.md';
    const archived = 'openspec/changes/archive/2026-10-25-example/proposal.md';
    await mkdir(path.dirname(path.join(repository, active)), { recursive: true });
    await writeFile(path.join(repository, active), '# Example\n');
    await execFileAsync('git', ['add', active], { cwd: repository });
    await execFileAsync('git', ['commit', '-m', 'feat: add specification change'], {
      cwd: repository,
    });
    await execFileAsync('git', ['push', '-u', 'origin', 'spec/archive-move'], {
      cwd: repository,
    });
    await mkdir(path.dirname(path.join(repository, archived)), { recursive: true });
    await rename(path.join(repository, active), path.join(repository, archived));

    const mergeRequest: MergeRequestIdentity = {
      provider: 'github',
      repositoryId: 'workspace',
      number: 17,
      url: 'https://github.com/team/workspace/pull/17',
    };
    const mergeRequests: MergeRequestPort = {
      capability: () => Promise.reject(new Error('not used')),
      find: () => Promise.resolve(null),
      findAll: () => Promise.resolve([]),
      create: () => Promise.resolve(mergeRequest),
      update: () => Promise.reject(new Error('not used')),
      status: async () => ({
        ...mergeRequest,
        state: 'open',
        sourceBranch: 'repoctopus/archive/example-aaaaaaaaaaaa',
        targetBranch: 'main',
        headCommit: (
          await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repository })
        ).stdout.trim(),
        ci: 'pending',
        review: 'pending',
        conversationsResolved: null,
        mergeCommit: null,
        mergedAt: null,
      }),
    };
    const closure: SpecificationClosureResult = {
      apiVersion: 'repoctopus.specification/v1alpha1',
      kind: 'SpecificationClosureResult',
      changeId: 'example',
      provider: {
        id: 'openspec',
        version: '1.0.0',
        protocolVersion: 'repoctopus.specification/v1alpha1',
      },
      planDigest: `sha256:${'b'.repeat(64)}`,
      closureId: `sha256:${'a'.repeat(64)}`,
      status: 'closed',
      archiveId: '2026-10-25-example',
      changedFiles: [active, archived],
    };

    const result = await new SpecificationPublicationAdapter(mergeRequests).publish({
      changeId: 'example',
      generation: 1,
      workspaceRoot: repository,
      changeBranch: {
        repositoryId: 'workspace',
        remoteIdentity: 'github.com/team/workspace',
        sourceBranch: 'spec/archive-move',
        targetBranch: 'main',
        remoteOid: (
          await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repository })
        ).stdout.trim(),
      },
      closure,
      remote: 'origin',
      title: 'Archive example',
      body: 'Verified archive publication',
    });

    expect(result.item).toMatchObject({
      sourceBranch: 'repoctopus/archive/example-aaaaaaaaaaaa',
      publishedOid: result.expectedPublishedOid,
      provenance: 'runtime-created',
    });
    expect(
      (
        await execFileAsync(
          'git',
          ['ls-remote', '--heads', 'origin', 'refs/heads/repoctopus/archive/example-aaaaaaaaaaaa'],
          { cwd: repository },
        )
      ).stdout.trim(),
    ).toContain(result.expectedPublishedOid);
  });
});
