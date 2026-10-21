import { readFile, writeFile } from 'node:fs/promises';

import type { Context, Plugin } from '@deepseek-ai/cordis';

import { bootApp } from '../../app/boot/boot.js';
import { compileRunnerComposition } from '../../app/boot/project-composition.js';
import { FinalChangePublicationService } from '../../domains/delivery/final-change-publication.js';
import type { FinalMergeRequestPort, MergeRequestInput } from '../../domains/delivery/ports.js';
import type {
  MergeRequestIdentity,
  MergeRequestStatus,
  PlatformCapability,
} from '../../domains/delivery/types.js';
import type { PostMergeReady } from '../../domains/post-merge/run.js';
import { GitDeliveryAdapter } from '../../platform/git/delivery.js';
import { execute } from '../../platform/process/execute.js';
import { loadProjectConfig } from '../../platform/project-configuration/file-config.js';
import { createRepoctopusBuiltinCatalog } from '../../plugins/builtin-catalog.js';
import { PostMergeActions } from '../../services/post-merge-actions.js';

interface Input {
  productRoot: string;
  workspaceRoot: string;
  temporaryRoot: string;
  workflowSource: string;
  evidenceProfile: string;
  coordination: PostMergeReady;
  sources: Array<{ repositoryId: string; path: string }>;
  mergeRequestStateFile: string;
  workspaceRemote: string;
}

interface MergeRequestState {
  created: number;
  updated: number;
  mergeRequests: Array<
    MergeRequestIdentity & {
      sourceBranch: string;
      targetBranch: string;
      title: string;
      body: string;
    }
  >;
}

async function load(file: string): Promise<MergeRequestState> {
  return JSON.parse(await readFile(file, 'utf8')) as MergeRequestState;
}

async function save(file: string, state: MergeRequestState): Promise<void> {
  await writeFile(file, `${JSON.stringify(state, null, 2)}\n`);
}

function sameIdentity(left: MergeRequestIdentity, right: MergeRequestIdentity): boolean {
  return (
    left.provider === right.provider &&
    left.repositoryId === right.repositoryId &&
    left.number === right.number &&
    left.url === right.url
  );
}

class FileFinalMergeRequests implements FinalMergeRequestPort {
  constructor(
    private readonly file: string,
    private readonly workspaceRemote: string,
  ) {}

  capability(): Promise<PlatformCapability> {
    return Promise.resolve({
      name: 'branch-protection',
      status: 'available',
      blocking: false,
      diagnosticCode: 'mock.branch-protection.available',
    });
  }

  async find(input: MergeRequestInput): Promise<MergeRequestIdentity | null> {
    return (await this.findAll(input))[0] ?? null;
  }

  async findAll(input: MergeRequestInput): Promise<MergeRequestIdentity[]> {
    const state = await load(this.file);
    return state.mergeRequests
      .filter(
        (item) =>
          item.repositoryId === input.repositoryId &&
          item.sourceBranch === input.sourceBranch &&
          item.targetBranch === input.targetBranch,
      )
      .map(({ provider, repositoryId, number, url }) => ({
        provider,
        repositoryId,
        number,
        url,
      }));
  }

  async create(input: MergeRequestInput): Promise<MergeRequestIdentity> {
    const state = await load(this.file);
    const identity: MergeRequestIdentity = {
      provider: 'github',
      repositoryId: input.repositoryId,
      number: 101,
      url: 'https://mock.invalid/workspace/pull/101',
    };
    state.created += 1;
    state.mergeRequests.push({ ...identity, ...input });
    await save(this.file, state);
    return identity;
  }

  async update(
    identity: MergeRequestIdentity,
    input: MergeRequestInput,
  ): Promise<MergeRequestIdentity> {
    const state = await load(this.file);
    const current = state.mergeRequests.find((item) => sameIdentity(item, identity));
    if (!current) throw new Error('Mock final MR was not found');
    current.title = input.title;
    current.body = input.body;
    state.updated += 1;
    await save(this.file, state);
    return structuredClone(identity);
  }

  async status(identity: MergeRequestIdentity): Promise<MergeRequestStatus> {
    const state = await load(this.file);
    const current = state.mergeRequests.find((item) => sameIdentity(item, identity));
    if (!current) throw new Error('Mock final MR was not found');
    const headCommit = (
      await execute('git', [
        '--git-dir',
        this.workspaceRemote,
        'rev-parse',
        `refs/heads/${current.sourceBranch}`,
      ])
    ).stdout.trim();
    return {
      provider: current.provider,
      repositoryId: current.repositoryId,
      number: current.number,
      url: current.url,
      state: 'open',
      sourceBranch: current.sourceBranch,
      targetBranch: current.targetBranch,
      headCommit,
      title: current.title,
      body: current.body,
      ci: 'pending',
      review: 'pending',
      conversationsResolved: null,
      mergeCommit: null,
      mergedAt: null,
    };
  }
}

async function main(): Promise<void> {
  const inputFile = process.argv[2];
  const mode = process.argv[3] ?? 'resume';
  if (!inputFile) throw new Error('Final Change Post-merge fixture input is required');
  const input = JSON.parse(await readFile(inputFile, 'utf8')) as Input;
  const config = await loadProjectConfig(input.workspaceRoot);
  const catalog = new Map(await createRepoctopusBuiltinCatalog(input.productRoot));
  const registration = catalog.get('post-merge-actions');
  if (!registration) throw new Error('Post-merge Actions plugin is missing');
  const actionsPlugin = ((context: Context) => {
    new PostMergeActions(context, {
      workspaceRoot: input.workspaceRoot,
      temporaryRoot: input.temporaryRoot,
      publicationPolicy: {
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'PostMergePublicationPolicy',
        operations: ['merge_target', 'commit', 'push', 'merge_request.create_or_recover'],
        remote: 'origin',
        commit: {
          message: 'chore(spec): close verified change',
          authorName: 'Repoctopus E2E',
          authorEmail: 'repoctopus-e2e@example.invalid',
        },
        mergeRequest: {
          title: 'Closed final Change',
          body: 'Evidence and specification closure are complete.',
        },
      },
    });
  }) as Plugin;
  Object.assign(actionsPlugin, {
    inject: PostMergeActions.inject,
    provide: 'postMergeActions',
  });
  catalog.set('post-merge-actions', { ...registration, plugin: actionsPlugin });
  const composition = compileRunnerComposition(
    input.productRoot,
    input.workspaceRoot,
    config,
    catalog,
  );
  const app = await bootApp({ composition, catalog });
  try {
    const mergeRequests = new FileFinalMergeRequests(
      input.mergeRequestStateFile,
      input.workspaceRemote,
    );
    const publisher = new FinalChangePublicationService(new GitDeliveryAdapter(), mergeRequests);
    app.context.delivery.publishFinalChange = (request) => publisher.publish(request);
    app.context.postMergeCoordinator.wake = () => Promise.resolve(input.coordination);
    if (mode === 'interrupt-before-publish') {
      app.context.postMergeActions.publishChange = () =>
        Promise.reject(new Error('simulated-process-interruption-before-publish'));
    }
    try {
      const result = await app.context.postMergeCoordinator.execute({
        provider: 'github',
        remoteIdentity: input.coordination.repositories[0]!.remoteIdentity,
        number: 11,
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
      if (
        mode !== 'interrupt-before-publish' ||
        !(error instanceof Error) ||
        error.message !== 'simulated-process-interruption-before-publish'
      ) {
        throw error;
      }
      process.stdout.write(`${JSON.stringify({ status: 'interrupted' })}\n`);
    }
  } finally {
    await app.close();
  }
}

await main();
