import { readFile, writeFile } from 'node:fs/promises';

import type { Context, Plugin } from '@deepseek-ai/cordis';

import { bootApp } from '../../app/boot/boot.js';
import { compileRunnerComposition } from '../../app/boot/project-composition.js';
import { DeliveryService as DeliveryDomainService } from '../../domains/delivery/service.js';
import type {
  DeliveryIntent,
  DeliveryPolicy,
  DeliveryState,
  HumanDecisionResponse,
  MergeRequestIdentity,
  MergeRequestReference,
  MergeRequestStatus,
  PlatformCapability,
  TrustedActor,
} from '../../domains/delivery/types.js';
import type { MergeRequestInput, MergeRequestPort } from '../../domains/delivery/ports.js';
import type {
  PostMergePublicationReceipt,
  PostMergePublicationRequest,
} from '../../domains/delivery/post-merge.js';
import type { ProjectSnapshot } from '../../domains/project/types.js';
import { FileDeliveryEvidence } from '../../platform/delivery/file-delivery-evidence.js';
import { FileDeliveryStore } from '../../platform/delivery/file-delivery-store.js';
import { GitDeliveryAdapter } from '../../platform/git/delivery.js';
import { loadProjectConfig } from '../../platform/project-configuration/file-config.js';
import { execute } from '../../platform/process/execute.js';
import { createRepoctopusBuiltinCatalog } from '../../plugins/builtin-catalog.js';
import { Delivery, type DeliveryPreparation } from '../../services/delivery.js';
import { PostMergeActions } from '../../services/post-merge-actions.js';

interface MockMergeRequest extends MergeRequestStatus {
  remote?: string;
}

interface MockPlatformState {
  mergeRequests: MockMergeRequest[];
  updates: number;
}

async function loadState(file: string): Promise<MockPlatformState> {
  return JSON.parse(await readFile(file, 'utf8')) as MockPlatformState;
}

async function saveState(file: string, state: MockPlatformState): Promise<void> {
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

class FileMockMergeRequests implements MergeRequestPort {
  constructor(private readonly file: string) {}

  capability(): Promise<PlatformCapability> {
    return Promise.resolve({
      name: 'branch-protection',
      status: 'available',
      blocking: false,
      diagnosticCode: 'mock.branch-protection.available',
    });
  }

  find(): Promise<MergeRequestIdentity | null> {
    return Promise.resolve(null);
  }

  create(): Promise<never> {
    return Promise.reject(new Error('Mock platform does not create merge requests'));
  }

  async update(
    identity: MergeRequestIdentity,
    input: MergeRequestInput,
  ): Promise<MergeRequestIdentity> {
    const state = await loadState(this.file);
    const current = state.mergeRequests.find((item) => sameIdentity(item, identity));
    if (!current) throw new Error('Mock merge request not found');
    current.title = input.title;
    current.body = input.body;
    state.updates += 1;
    await saveState(this.file, state);
    return structuredClone(identity);
  }

  async status(identity: MergeRequestIdentity): Promise<MergeRequestStatus> {
    const state = await loadState(this.file);
    const current = state.mergeRequests.find((item) => sameIdentity(item, identity));
    if (!current) throw new Error('Mock merge request not found');
    const headCommit = current.remote
      ? (
          await execute('git', [
            '--git-dir',
            current.remote,
            'rev-parse',
            `refs/heads/${current.sourceBranch}`,
          ])
        ).stdout.trim()
      : current.headCommit;
    return { ...structuredClone(current), ...(headCommit ? { headCommit } : {}) };
  }
}

interface MockDeliveryConfig {
  workspaceRoot: string;
  stateFile: string;
}

class MockDeliveryProvider extends Delivery {
  static inject = ['compositionIdentity'];

  constructor(
    context: Context,
    private readonly config: MockDeliveryConfig,
  ) {
    super(context);
  }

  private domain(): DeliveryDomainService {
    const git = new GitDeliveryAdapter();
    return new DeliveryDomainService(
      new FileDeliveryStore(this.config.workspaceRoot),
      git,
      new FileMockMergeRequests(this.config.stateFile),
      new FileDeliveryEvidence(this.config.workspaceRoot),
      undefined,
      undefined,
      this.ctx.compositionIdentity.current().compositionDigest,
      git,
    );
  }

  checkpoint(
    project: ProjectSnapshot,
    intent: DeliveryIntent,
    policy: DeliveryPolicy,
  ): Promise<unknown> {
    return this.domain().checkpoint(project, intent, policy);
  }

  prepare(options: DeliveryPreparation): Promise<DeliveryState> {
    if (options.intent.schemaVersion === 3) {
      return Promise.reject(new Error('Mock Delivery provider only supports v2 fixtures'));
    }
    return this.domain().prepare({ ...options, intent: options.intent });
  }

  status(changeId: string): Promise<DeliveryState> {
    return this.domain().status(changeId);
  }

  decide(
    changeId: string,
    response: HumanDecisionResponse,
    actor: TrustedActor,
  ): Promise<DeliveryState> {
    return this.domain().decide(changeId, response, actor);
  }

  publish(options: DeliveryPreparation): Promise<DeliveryState> {
    if (options.intent.schemaVersion === 3) {
      return Promise.reject(new Error('Mock Delivery provider only supports v2 fixtures'));
    }
    return this.domain().publish({ ...options, intent: options.intent });
  }

  override publishPostMerge(
    request: PostMergePublicationRequest,
  ): Promise<PostMergePublicationReceipt> {
    return this.domain().publishPostMerge(request);
  }

  refresh(changeId: string, policy: DeliveryPolicy): Promise<DeliveryState> {
    void policy;
    return this.domain().refresh(changeId);
  }

  refreshForMergeRequest(reference: MergeRequestReference, policy: DeliveryPolicy) {
    void policy;
    return this.domain().refreshForMergeRequest(reference);
  }
}

async function main(): Promise<void> {
  const [productRoot, workspaceRoot] = process.argv.slice(2);
  const stateFile = process.env.REPOCTOPUS_MOCK_PLATFORM_STATE;
  if (!productRoot || !workspaceRoot || !stateFile) {
    throw new Error('Self-hosted fixture requires product root, workspace, and mock state');
  }
  const config = await loadProjectConfig(workspaceRoot);
  const catalog = new Map(await createRepoctopusBuiltinCatalog(productRoot));
  const registration = catalog.get('delivery-file');
  if (!registration) throw new Error('Delivery plugin is missing');
  const plugin = ((context: Context, pluginConfig: { workspaceRoot: string }) => {
    new MockDeliveryProvider(context, {
      workspaceRoot: pluginConfig.workspaceRoot,
      stateFile,
    });
  }) as Plugin;
  Object.assign(plugin, { inject: MockDeliveryProvider.inject, provide: 'delivery' });
  catalog.set('delivery-file', { ...registration, plugin });
  const actionsRegistration = catalog.get('post-merge-actions');
  if (!actionsRegistration) throw new Error('Post-merge actions plugin is missing');
  const legacyActionsPlugin = ((
    context: Context,
    pluginConfig: {
      workspaceRoot: string;
      temporaryRoot: string;
      verificationPathPrefixes: string[];
      publication: {
        remote: string;
        commit: { message: string };
        finalChangeMergeRequest: { title: string; body: string };
      };
    },
  ) => {
    // This fixture resumes a schema-v1 Journal created before the v3 configuration cutover.
    // Production composition never synthesizes this legacy policy from current project config.
    new PostMergeActions(context, {
      workspaceRoot: pluginConfig.workspaceRoot,
      temporaryRoot: pluginConfig.temporaryRoot,
      verificationPathPrefixes: pluginConfig.verificationPathPrefixes,
      publicationPolicy: {
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'PostMergePublicationPolicy',
        operations: ['commit', 'push', 'merge_request.update'],
        remote: pluginConfig.publication.remote,
        commit: {
          message: pluginConfig.publication.commit.message,
          authorName: 'Repoctopus E2E',
          authorEmail: 'repoctopus-e2e@example.invalid',
        },
        mergeRequest: {
          title: pluginConfig.publication.finalChangeMergeRequest.title,
          body: pluginConfig.publication.finalChangeMergeRequest.body,
        },
      },
    });
  }) as Plugin;
  Object.assign(legacyActionsPlugin, {
    inject: PostMergeActions.inject,
    provide: 'postMergeActions',
  });
  catalog.set('post-merge-actions', { ...actionsRegistration, plugin: legacyActionsPlugin });
  const composition = compileRunnerComposition(productRoot, workspaceRoot, config, catalog);
  const app = await bootApp({ composition, catalog });
  const executePostMerge = app.context.postMergeCoordinator.execute.bind(
    app.context.postMergeCoordinator,
  );
  app.context.postMergeCoordinator.execute = async (...args) => {
    try {
      return await executePostMerge(...args);
    } catch (error) {
      // The parent test only exposes child output on failure; payloads and credentials stay hidden.
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
      throw error;
    }
  };
  await app.context.httpHost.ready();
  process.stdout.write(
    `${JSON.stringify({ type: 'ready', origin: app.context.httpHost.origin(), compositionDigest: composition.compositionDigest })}\n`,
  );

  const stopped = new Promise<void>((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
  await stopped;
  await app.close();
}

await main();
