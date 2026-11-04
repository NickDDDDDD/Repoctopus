import { execFile } from 'node:child_process';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MergeRequestPort } from '../domains/delivery/ports.js';
import type {
  SpecificationPublicationRequest,
  SpecificationPublicationResult,
} from '../domains/delivery/specification-publication.js';
import type { MergeRequestIdentity } from '../domains/delivery/types.js';
import { PublicationResultUnknownError } from '../domains/delivery/publication-result-unknown.js';
import { PublicationNotAppliedError } from '../domains/delivery/publication-not-applied.js';
import type { SpecificationClosureResult } from '../domains/specification/types.js';
import {
  SpecificationPublicationAdapter,
  type SpecificationPublicationGitPort,
  type SpecificationPublicationFaultPoint,
} from '../platform/delivery/specification-publication.js';
import { GitSpecificationCheckoutManager } from '../platform/git/specification-checkout.js';
import {
  createGitRepository,
  removeTemporaryDirectory,
  temporaryDirectory,
} from './helpers/fixtures.js';

const execFileAsync = promisify(execFile);
const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

async function git(cwd: string, args: string[]): Promise<string> {
  return (await execFileAsync('git', args, { cwd })).stdout.trim();
}

interface Fixture {
  repository: string;
  checkoutManager: GitSpecificationCheckoutManager;
  request: SpecificationPublicationRequest;
  mergeRequests: MergeRequestPort;
  sourceBranch: string;
  createdMergeRequests: () => number;
  primaryHead: string;
}

async function fixture(): Promise<Fixture> {
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
  const primaryHead = await git(repository, ['rev-parse', 'HEAD']);
  const checkoutManager = new GitSpecificationCheckoutManager(repository);
  const checkoutId = 'closure-example';
  const checkout = await checkoutManager.create(checkoutId);
  await mkdir(path.dirname(path.join(checkout.root, archived)), { recursive: true });
  await rename(path.join(checkout.root, active), path.join(checkout.root, archived));

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
    candidate: { checkoutId, baseOid: primaryHead },
  };
  const sourceBranch = 'repoctopus/archive/example-aaaaaaaaaaaa';
  const mergeRequest: MergeRequestIdentity = {
    provider: 'github',
    repositoryId: 'workspace',
    number: 17,
    url: 'https://github.com/team/workspace/pull/17',
  };
  let created = 0;
  const mergeRequests: MergeRequestPort = {
    capability: () => Promise.reject(new Error('not used')),
    find: () => Promise.resolve(created ? mergeRequest : null),
    findAll: () => Promise.resolve(created ? [mergeRequest] : []),
    create: () => {
      created += 1;
      return Promise.resolve(mergeRequest);
    },
    update: () => Promise.reject(new Error('not used')),
    status: async () => ({
      ...mergeRequest,
      state: 'open',
      sourceBranch,
      targetBranch: 'main',
      headCommit: (await git(repository, ['ls-remote', '--heads', 'origin', sourceBranch])).split(
        /\s+/u,
      )[0]!,
      ci: 'pending',
      review: 'pending',
      conversationsResolved: null,
      mergeCommit: null,
      mergedAt: null,
    }),
  };
  return {
    repository,
    checkoutManager,
    mergeRequests,
    sourceBranch,
    createdMergeRequests: () => created,
    primaryHead,
    request: {
      changeId: 'example',
      runId: 'run-example',
      workspaceRoot: repository,
      changeBranch: {
        repositoryId: 'workspace',
        remoteIdentity: 'github.com/team/workspace',
        sourceBranch: 'spec/archive-move',
        targetBranch: 'main',
        remoteOid: primaryHead,
      },
      closure,
      remote: 'origin',
      title: 'Archive example',
      body: 'Verified archive publication',
    },
  };
}

async function expectPublished(
  setup: Fixture,
  result: SpecificationPublicationResult,
  provenance: 'runtime-created' | 'recovered' = 'runtime-created',
) {
  expect(result.item).toMatchObject({
    sourceBranch: setup.sourceBranch,
    publishedOid: result.expectedPublishedOid,
    provenance,
  });
  expect(
    await git(setup.repository, [
      'ls-remote',
      '--heads',
      'origin',
      `refs/heads/${setup.sourceBranch}`,
    ]),
  ).toContain(result.expectedPublishedOid);
  expect(await git(setup.repository, ['rev-parse', 'HEAD'])).toBe(setup.primaryHead);
  expect(await git(setup.repository, ['status', '--porcelain=v1', '--untracked-files=no'])).toBe(
    '',
  );
  expect(await setup.checkoutManager.find('closure-example')).toBeNull();
}

describe('Specification publication adapter', () => {
  it('never repeats a Specification push while its result is unknown', async () => {
    const setup = await fixture();
    let observable = false;
    let pushedOid: string | null = null;
    const push = vi.fn(async (cwd: string, remote: string, oid: string, branch: string) => {
      pushedOid = oid;
      await execFileAsync('git', ['push', remote, `${oid}:refs/heads/${branch}`], { cwd });
      throw new Error('push response and immediate observation unavailable');
    });
    const publicationGit: SpecificationPublicationGitPort = {
      observeRemoteOid: () => Promise.resolve(observable ? pushedOid : null),
      push,
    };
    const adapter = () =>
      new SpecificationPublicationAdapter(
        setup.mergeRequests,
        undefined,
        undefined,
        publicationGit,
      );

    await expect(adapter().publish(setup.request)).rejects.toBeInstanceOf(
      PublicationResultUnknownError,
    );
    await expect(adapter().publish(setup.request)).rejects.toBeInstanceOf(
      PublicationResultUnknownError,
    );
    expect(push).toHaveBeenCalledOnce();

    observable = true;
    const recovered = await adapter().publish(setup.request);
    await expectPublished(setup, recovered);
    expect(push).toHaveBeenCalledOnce();
  });

  it('reconciles an uncertain merge-request creation without invoking create again', async () => {
    const setup = await fixture();
    const mergeRequest: MergeRequestIdentity = {
      provider: 'github',
      repositoryId: 'workspace',
      number: 17,
      url: 'https://github.com/team/workspace/pull/17',
    };
    let observable = false;
    const create = vi.fn().mockRejectedValue(new Error('create response unavailable'));
    setup.mergeRequests.create = create;
    setup.mergeRequests.find = () => Promise.resolve(observable ? mergeRequest : null);
    setup.mergeRequests.findAll = () => Promise.resolve(observable ? [mergeRequest] : []);

    await expect(
      new SpecificationPublicationAdapter(setup.mergeRequests).publish(setup.request),
    ).rejects.toBeInstanceOf(PublicationResultUnknownError);
    await expect(
      new SpecificationPublicationAdapter(setup.mergeRequests).publish(setup.request),
    ).rejects.toBeInstanceOf(PublicationResultUnknownError);
    expect(create).toHaveBeenCalledOnce();

    observable = true;
    const recovered = await new SpecificationPublicationAdapter(setup.mergeRequests).publish(
      setup.request,
    );
    await expectPublished(setup, recovered, 'recovered');
    expect(create).toHaveBeenCalledOnce();
  });

  it('retries the same stable Specification intent after a definite create rejection', async () => {
    const setup = await fixture();
    const successfulCreate = setup.mergeRequests.create.bind(setup.mergeRequests);
    const create = vi
      .fn<MergeRequestPort['create']>()
      .mockRejectedValueOnce(
        Object.assign(new Error('request rejected'), {
          effect: 'not-applied' as const,
          code: 'permission',
        }),
      )
      .mockImplementation(successfulCreate);
    setup.mergeRequests.create = create;

    await expect(
      new SpecificationPublicationAdapter(setup.mergeRequests).publish(setup.request),
    ).rejects.toBeInstanceOf(PublicationNotAppliedError);
    expect(create).toHaveBeenCalledOnce();

    const recovered = await new SpecificationPublicationAdapter(setup.mergeRequests).publish(
      setup.request,
    );
    await expectPublished(setup, recovered);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('publishes the isolated archive candidate without mutating the developer branch', async () => {
    const setup = await fixture();
    const result = await new SpecificationPublicationAdapter(setup.mergeRequests).publish(
      setup.request,
    );

    await expectPublished(setup, result);
    expect(setup.createdMergeRequests()).toBe(1);
    await expect(
      new SpecificationPublicationAdapter(setup.mergeRequests).publish(setup.request),
    ).resolves.toEqual(result);
    expect(setup.createdMergeRequests()).toBe(1);
  });

  it.each(['after-commit', 'after-push', 'after-mr'] as const)(
    'recovers exactly once after a %s interruption',
    async (faultPoint: SpecificationPublicationFaultPoint) => {
      const setup = await fixture();
      let injected = false;
      const interrupted = new SpecificationPublicationAdapter(setup.mergeRequests, (point) => {
        if (!injected && point === faultPoint) {
          injected = true;
          throw new Error(`fault:${point}`);
        }
      });

      await expect(interrupted.publish(setup.request)).rejects.toThrow(`fault:${faultPoint}`);
      const recovered = await new SpecificationPublicationAdapter(setup.mergeRequests).publish(
        setup.request,
      );

      await expectPublished(
        setup,
        recovered,
        faultPoint === 'after-mr' ? 'recovered' : 'runtime-created',
      );
      expect(setup.createdMergeRequests()).toBe(1);
    },
  );
});
