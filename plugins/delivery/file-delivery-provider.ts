import type { Context } from '@deepseek-ai/cordis';

import { DeliveryService as DeliveryDomainService } from '../../domains/delivery/service.js';
import type {
  DeliveryIntent,
  DeliveryPolicy,
  DeliveryState,
  HumanDecisionResponse,
  TrustedActor,
} from '../../domains/delivery/types.js';
import type { ProjectSnapshot } from '../../domains/project/types.js';
import { FileDeliveryEvidence } from '../../platform/delivery/file-delivery-evidence.js';
import { FileDeliveryStore } from '../../platform/delivery/file-delivery-store.js';
import { GitDeliveryAdapter } from '../../platform/git/delivery.js';
import {
  EnvironmentCredentialProvider,
  GitHubMergeRequestAdapter,
} from '../../platform/github/merge-request.js';
import { deliveryTelemetryFromEnvironment } from '../../platform/telemetry/opentelemetry/exporter.js';
import { Delivery, type DeliveryPreparation } from '../../services/delivery.js';
import {
  bindOperationOwnership,
  type OperationOwnership,
} from '../../services/operation-ownership.js';

export interface FileDeliveryConfig {
  workspaceRoot: string;
  environment?: NodeJS.ProcessEnv;
}

export class FileDeliveryProvider extends Delivery {
  static inject = ['compositionIdentity'];
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
    return new DeliveryDomainService(
      new FileDeliveryStore(this.config.workspaceRoot),
      new GitDeliveryAdapter(),
      new GitHubMergeRequestAdapter(
        new EnvironmentCredentialProvider(environment),
        policy?.publication.githubApiBaseUrl,
      ),
      new FileDeliveryEvidence(this.config.workspaceRoot),
      undefined,
      deliveryTelemetryFromEnvironment(environment),
      this.ctx.compositionIdentity.current().compositionDigest,
    );
  }

  checkpoint(
    project: ProjectSnapshot,
    intent: DeliveryIntent,
    policy: DeliveryPolicy,
    signal?: AbortSignal,
  ) {
    return this.operations.run({ cancellable: false, signal }, () =>
      this.domain(policy).checkpoint(project, intent, policy),
    );
  }

  prepare(options: DeliveryPreparation, signal?: AbortSignal): Promise<DeliveryState> {
    return this.operations.run({ cancellable: false, signal }, () =>
      this.domain(options.policy).prepare(options),
    );
  }

  status(changeId: string, signal?: AbortSignal): Promise<DeliveryState> {
    return this.operations.run({ cancellable: true, signal }, () => this.domain().status(changeId));
  }

  decide(
    changeId: string,
    response: HumanDecisionResponse,
    actor: TrustedActor,
    signal?: AbortSignal,
  ): Promise<DeliveryState> {
    return this.operations.run({ cancellable: false, signal }, () =>
      this.domain().decide(changeId, response, actor),
    );
  }

  publish(options: DeliveryPreparation, signal?: AbortSignal): Promise<DeliveryState> {
    return this.operations.run({ cancellable: false, signal }, () =>
      this.domain(options.policy).publish(options),
    );
  }

  refresh(changeId: string, policy: DeliveryPolicy, signal?: AbortSignal): Promise<DeliveryState> {
    return this.operations.run({ cancellable: false, signal }, () =>
      this.domain(policy).refresh(changeId),
    );
  }
}
