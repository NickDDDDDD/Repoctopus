import type { Context } from '@deepseek-ai/cordis';

import { DeliveryService as DeliveryDomainService } from '../../domains/delivery/service.js';
import { DeliveryServiceV3 } from '../../domains/delivery/service-v3.js';
import type {
  DeliveryIntent,
  DeliveryIntentV3,
  DeliveryPolicy,
  DeliveryState,
  DeliveryStateV3,
  HumanDecisionResponse,
  MergeRequestReference,
  TrustedActor,
  MergeRequestStatus,
} from '../../domains/delivery/types.js';
import type { PublicationReceiptItem } from '../../domains/delivery/publication-receipt.js';
import type {
  SpecificationPublicationRequest,
  SpecificationPublicationResult,
} from '../../domains/delivery/specification-publication.js';
import type { DeliveryV2MigrationPlan } from '../../domains/delivery/migration.js';
import type { ArchivePublicationResult } from '../../domains/delivery/service-v3.js';
import type { ProjectSnapshot } from '../../domains/project/types.js';
import { canonicalJson } from '../../domains/workflow-contract/canonical.js';
import { FileDeliveryEvidence } from '../../platform/delivery/file-delivery-evidence.js';
import { SpecificationPublicationAdapter } from '../../platform/delivery/specification-publication.js';
import { FileDeliveryStore } from '../../platform/delivery/file-delivery-store.js';
import { FilePublicationJournalStore } from '../../platform/delivery/file-publication-journal-store.js';
import {
  deliveryStateSchemaVersion,
  FileDeliveryV3Store,
} from '../../platform/delivery/file-delivery-v3-store.js';
import { GitDeliveryAdapter } from '../../platform/git/delivery.js';
import { inspectRemoteChangeBranch } from '../../platform/git/change-branch.js';
import {
  EnvironmentCredentialProvider,
  GitHubMergeRequestAdapter,
} from '../../platform/github/merge-request.js';
import { Delivery, type DeliveryPreparation } from '../../services/delivery.js';
import { DeliveryObservationTelemetry } from '../../services/observation-telemetry.js';
import {
  bindOperationOwnership,
  type OperationOwnership,
} from '../../services/operation-ownership.js';

export interface FileDeliveryConfig {
  workspaceRoot: string;
  projectConfigDigest: `sha256:${string}`;
  environment?: NodeJS.ProcessEnv;
  githubTokenVariable?: string;
}

export class FileDeliveryProvider extends Delivery {
  static inject = ['compositionIdentity', 'observationDelivery', 'specificationPlanning'];
  private readonly operations: OperationOwnership;

  constructor(
    context: Context,
    private readonly config: FileDeliveryConfig,
  ) {
    super(context);
    this.operations = bindOperationOwnership(context, 'delivery');
  }

  private domain(policy?: DeliveryPolicy): DeliveryDomainService {
    const environment = this.config.environment ?? process.env;
    const git = new GitDeliveryAdapter();
    return new DeliveryDomainService(
      new FileDeliveryStore(this.config.workspaceRoot),
      git,
      new GitHubMergeRequestAdapter(
        new EnvironmentCredentialProvider(environment, this.config.githubTokenVariable),
        policy?.publication.githubApiBaseUrl,
      ),
      new FileDeliveryEvidence(this.config.workspaceRoot),
      undefined,
      new DeliveryObservationTelemetry(this.ctx.observationDelivery, environment),
      this.ctx.compositionIdentity.current().compositionDigest,
    );
  }

  private domainV3(policy?: DeliveryPolicy): DeliveryServiceV3 {
    const environment = this.config.environment ?? process.env;
    const git = new GitDeliveryAdapter();
    const mergeRequests = new GitHubMergeRequestAdapter(
      new EnvironmentCredentialProvider(environment, this.config.githubTokenVariable),
      policy?.publication.githubApiBaseUrl,
    );
    return new DeliveryServiceV3(
      new FileDeliveryV3Store(this.config.workspaceRoot),
      git,
      mergeRequests,
      new FileDeliveryEvidence(this.config.workspaceRoot),
      new FilePublicationJournalStore(this.config.workspaceRoot),
      this.ctx.compositionIdentity.current().compositionDigest,
      undefined,
    );
  }

  override observePublication(
    item: PublicationReceiptItem,
    signal?: AbortSignal,
  ): Promise<MergeRequestStatus> {
    return this.operations.run({ cancellable: true, signal }, async () => {
      const environment = this.config.environment ?? process.env;
      const adapter = new GitHubMergeRequestAdapter(
        new EnvironmentCredentialProvider(environment, this.config.githubTokenVariable),
      );
      const status = await adapter.status(item.mergeRequest);
      if (
        status.repositoryId !== item.repositoryId ||
        status.sourceBranch !== item.sourceBranch ||
        status.targetBranch !== item.targetBranch
      ) {
        throw new Error(`Observed publication identity drifted: ${item.publicationId}`);
      }
      return status;
    });
  }

  private async assertPlanningApproval(
    intent: DeliveryIntentV3,
    remote: string,
    planningCompositionDigest = this.ctx.compositionIdentity.current().compositionDigest,
  ): Promise<void> {
    const approval = await this.ctx.specificationPlanning.status(intent.changeId);
    const currentChangeBranch = await inspectRemoteChangeBranch({
      repositoryPath: this.config.workspaceRoot,
      repositoryId: intent.changeBranch.repositoryId,
      remote,
      sourceBranch: intent.changeBranch.sourceBranch,
      targetBranch: intent.changeBranch.targetBranch,
    });
    const branchCoordinates = (branch: DeliveryIntentV3['changeBranch']) => ({
      repositoryId: branch.repositoryId,
      remoteIdentity: branch.remoteIdentity,
      sourceBranch: branch.sourceBranch,
      targetBranch: branch.targetBranch,
    });
    if (
      !approval ||
      approval.status !== 'approved' ||
      approval.decision?.decision !== 'approve' ||
      approval.snapshot.changeId !== intent.changeId ||
      this.ctx.compositionIdentity.current().compositionDigest !== planningCompositionDigest ||
      canonicalJson(branchCoordinates(approval.snapshot.changeBranch)) !==
        canonicalJson(branchCoordinates(intent.changeBranch)) ||
      canonicalJson(currentChangeBranch) !== canonicalJson(intent.changeBranch)
    ) {
      throw new Error(
        `Delivery v3 requires an effective planning approval for Change branch: ${intent.changeId}`,
      );
    }
  }

  override validateArchiveIntent(
    intent: DeliveryIntentV3,
    policy: DeliveryPolicy,
    planningCompositionDigest: `sha256:${string}`,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.operations.run({ cancellable: true, signal }, () =>
      this.assertPlanningApproval(intent, policy.publication.remote, planningCompositionDigest),
    );
  }

  private legacyReadOnly(operation: string): never {
    throw new Error(
      `Delivery v2 is read-only and cannot ${operation}; inspect status and create a v3 migration plan`,
    );
  }

  checkpoint(
    project: ProjectSnapshot,
    intent: DeliveryIntent | DeliveryIntentV3,
    policy: DeliveryPolicy,
    signal?: AbortSignal,
  ) {
    return this.operations.run({ cancellable: false, signal }, async () => {
      if (intent.schemaVersion === 3) {
        await this.assertPlanningApproval(intent, policy.publication.remote);
        return this.domainV3(policy).checkpoint(project, intent, policy);
      }
      return this.legacyReadOnly('checkpoint');
    });
  }

  prepare(
    options: DeliveryPreparation,
    signal?: AbortSignal,
  ): Promise<DeliveryState | DeliveryStateV3> {
    return this.operations.run({ cancellable: false, signal }, async () => {
      if (options.intent.schemaVersion === 3) {
        await this.assertPlanningApproval(options.intent, options.policy.publication.remote);
        return this.domainV3(options.policy).prepare({ ...options, intent: options.intent });
      }
      return this.legacyReadOnly('prepare');
    });
  }

  status(changeId: string, signal?: AbortSignal): Promise<DeliveryState | DeliveryStateV3> {
    return this.operations.run({ cancellable: true, signal }, async () => {
      const version = await deliveryStateSchemaVersion(this.config.workspaceRoot, changeId);
      if (version === 3) return this.domainV3().status(changeId);
      return this.domain().status(changeId);
    });
  }

  decide(
    changeId: string,
    response: HumanDecisionResponse,
    actor: TrustedActor,
    signal?: AbortSignal,
  ): Promise<DeliveryState | DeliveryStateV3> {
    return this.operations.run({ cancellable: false, signal }, async () => {
      const version = await deliveryStateSchemaVersion(this.config.workspaceRoot, changeId);
      if (version !== 3) return this.legacyReadOnly('record a decision');
      return this.domainV3().decide(changeId, response, actor);
    });
  }

  publish(
    options: DeliveryPreparation,
    signal?: AbortSignal,
  ): Promise<DeliveryState | DeliveryStateV3> {
    return this.operations.run({ cancellable: false, signal }, async () => {
      if (options.intent.schemaVersion === 3) {
        await this.assertPlanningApproval(options.intent, options.policy.publication.remote);
        return this.domainV3(options.policy).publish({ ...options, intent: options.intent });
      }
      return this.legacyReadOnly('publish');
    });
  }

  override publishArchive(
    options: DeliveryPreparation & {
      intent: DeliveryIntentV3;
      expectedRepositoryHeads: Readonly<Record<string, string>>;
    },
    signal?: AbortSignal,
  ): Promise<ArchivePublicationResult> {
    return this.operations.run({ cancellable: false, signal }, async () => {
      await this.assertPlanningApproval(
        options.intent,
        options.policy.publication.remote,
        options.planningCompositionDigest,
      );
      return this.domainV3(options.policy).publishArchive(options);
    });
  }

  override publishSpecification(
    request: SpecificationPublicationRequest,
    signal?: AbortSignal,
  ): Promise<SpecificationPublicationResult> {
    return this.operations.run({ cancellable: false, signal }, () => {
      const environment = this.config.environment ?? process.env;
      const mergeRequests = new GitHubMergeRequestAdapter(
        new EnvironmentCredentialProvider(environment, this.config.githubTokenVariable),
      );
      return new SpecificationPublicationAdapter(mergeRequests).publish(request);
    });
  }

  refresh(
    changeId: string,
    policy: DeliveryPolicy,
    signal?: AbortSignal,
  ): Promise<DeliveryState | DeliveryStateV3> {
    return this.operations.run({ cancellable: false, signal }, async () => {
      const version = await deliveryStateSchemaVersion(this.config.workspaceRoot, changeId);
      if (version !== 3) return this.legacyReadOnly('refresh');
      return (await this.domainV3(policy).refresh(changeId)).state;
    });
  }

  refreshForMergeRequest(
    reference: MergeRequestReference,
    policy: DeliveryPolicy,
    signal?: AbortSignal,
  ) {
    return this.operations.run({ cancellable: false, signal }, async () => {
      return this.domainV3(policy).refreshForMergeRequest(reference);
    });
  }

  override reconciliationCandidates(signal?: AbortSignal) {
    return this.operations.run({ cancellable: true, signal }, () =>
      this.domainV3().reconciliationCandidates(),
    );
  }

  override migrationPlan(
    changeId: string,
    policy: DeliveryPolicy,
    signal?: AbortSignal,
  ): Promise<DeliveryV2MigrationPlan> {
    return this.operations.run({ cancellable: true, signal }, async () => {
      const version = await deliveryStateSchemaVersion(this.config.workspaceRoot, changeId);
      if (version !== 2) {
        throw new Error(`Delivery migration plan requires a v2 state: ${changeId}`);
      }
      return this.domain(policy).migrationPlan(changeId);
    });
  }
}
