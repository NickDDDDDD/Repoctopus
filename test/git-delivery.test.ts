import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  DeliveryIntent,
  DeliveryPolicy,
  DeliveryRepositoryIntent,
} from '../domains/delivery/types.js';
import { createPublicationPlan } from '../domains/delivery/snapshot.js';
import { parseDeliveryPolicy } from '../platform/delivery/config.js';
import { GitDeliveryAdapter } from '../platform/git/delivery.js';
import { probeProject } from '../platform/git/probe.js';
import {
  createGitRepository,
  removeTemporaryDirectory,
  temporaryDirectory,
} from './helpers/fixtures.js';

const execFileAsync = promisify(execFile);
const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

const policy: DeliveryPolicy = {
  apiVersion: 'repoctopus/v1alpha1',
  kind: 'DeliveryPolicy',
  checkpoint: {
    automatic: true,
    protectedBranches: ['main', 'release/*'],
    commitMessagePattern: '^feat: .+',
    quickChecks: {},
  },
  publication: {
    remote: 'origin',
    provider: 'github',
    githubApiBaseUrl: 'https://api.github.com',
    mrTitleTemplate: '{{changeId}}',
    mrBodyTemplate: '{{verificationReport}}',
  },
};

async function fixture() {
  const root = await temporaryDirectory('repoctopus-delivery-git-');
  cleanup.push(root);
  const remote = path.join(root, 'remote.git');
  await mkdir(remote);
  await execFileAsync('git', ['init', '--bare'], { cwd: remote });
  const repositoryPath = await createGitRepository(root, 'app', remote);
  await execFileAsync('git', ['push', '-u', 'origin', 'main'], { cwd: repositoryPath });
  await execFileAsync('git', ['switch', '-c', 'feat/change'], { cwd: repositoryPath });
  const project = await probeProject({ root });
  const repository = project.repositories.find((item) => item.name === 'app')!;
  const selected: DeliveryRepositoryIntent = {
    repositoryId: repository.id,
    sourceBranch: 'feat/change',
    targetBranch: 'main',
    commitMessage: 'feat: deliver change',
    actions: ['push', 'merge_request'],
  };
  return { root, remote, repositoryPath, repository, selected };
}

describe('Git delivery adapter', () => {
  it('creates a local checkpoint and publishes with remote drift protection', async () => {
    const setup = await fixture();
    await writeFile(path.join(setup.repositoryPath, 'feature.txt'), 'content');
    const adapter = new GitDeliveryAdapter();
    const checkpoint = await adapter.checkpoint(setup.repository, setup.selected, policy);
    expect(checkpoint.created).toBe(true);
    const facts = await adapter.inspect(setup.repository, setup.selected, policy);
    expect(facts).toMatchObject({
      clean: true,
      sourceBranch: 'feat/change',
      remoteSourceOid: null,
    });
    const intent: DeliveryIntent = {
      schemaVersion: 1,
      changeId: 'deliver-change',
      repositories: [{ ...setup.selected, actions: [...setup.selected.actions] }],
    };
    const push = createPublicationPlan(intent, [facts]).find(
      (action) => action.type === 'git.push',
    )!;
    expect(await adapter.push(setup.repository, push, policy)).toBe(facts.head);
    expect(await adapter.push(setup.repository, push, policy)).toBe(facts.head);
  });

  it('rejects protected branches and invalid commit messages without committing', async () => {
    const setup = await fixture();
    await execFileAsync('git', ['switch', 'main'], { cwd: setup.repositoryPath });
    await writeFile(path.join(setup.repositoryPath, 'blocked.txt'), 'blocked');
    const adapter = new GitDeliveryAdapter();
    await expect(
      adapter.checkpoint(setup.repository, { ...setup.selected, sourceBranch: 'main' }, policy),
    ).rejects.toThrow(/protected branch/i);
    await execFileAsync('git', ['switch', 'feat/change'], { cwd: setup.repositoryPath });
    await expect(
      adapter.checkpoint(
        setup.repository,
        { ...setup.selected, commitMessage: 'bad message' },
        policy,
      ),
    ).rejects.toThrow(/does not match/i);
    expect(
      (
        await execFileAsync('git', ['log', '--oneline', '--all'], { cwd: setup.repositoryPath })
      ).stdout
        .trim()
        .split('\n'),
    ).toHaveLength(1);
  });

  it('loads the documented delivery policy and fails closed on missing commit format', () => {
    const source = `apiVersion: repoctopus/v1alpha1\nkind: DeliveryPolicy\ncheckpoint:\n  automatic: true\n  protectedBranches: [main]\n  commitMessagePattern: '^feat: .+'\n  quickChecks: {}\npublication:\n  remote: origin\n  provider: github\n  githubApiBaseUrl: https://api.github.com\n  mrTitleTemplate: title\n  mrBodyTemplate: body\n`;
    expect(parseDeliveryPolicy(source).checkpoint.automatic).toBe(true);
    expect(() =>
      parseDeliveryPolicy(source.replace("  commitMessagePattern: '^feat: .+'\n", '')),
    ).toThrow(/commit message format/i);
  });

  it('loads delivery policy from the unified project configuration', () => {
    const source = `apiVersion: repoctopus/v1alpha1
kind: RepoctopusProject
project: { id: sample }
repositories:
  - { id: app, path: ../app }
profiles:
  - id: verify
    nodes:
      - { id: build, type: command, repository: app, executable: npm, args: [run, build] }
delivery:
  checkpoint:
    automatic: true
    protectedBranches: [main]
    commitMessagePattern: '^feat: .+'
    quickChecks: {}
  publication:
    remote: origin
    provider: github
    githubApiBaseUrl: https://api.github.com
    mrTitleTemplate: title
    mrBodyTemplate: body
`;
    expect(parseDeliveryPolicy(source)).toMatchObject({
      kind: 'DeliveryPolicy',
      checkpoint: { automatic: true },
      publication: { remote: 'origin' },
    });
  });
});
