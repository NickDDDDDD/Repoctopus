import type { RepositorySnapshot } from '../project/types.js';
import type {
  CheckpointResult,
  DeliveryPolicy,
  DeliveryRepositoryFacts,
  DeliveryRepositoryIntent,
  DeliveryState,
  DeliveryStateV3,
  MergeRequestIdentity,
  MergeRequestStatus,
  PlatformCapability,
  PublicationAction,
} from './types.js';

export interface DeliveryEvent {
  schemaVersion: 1;
  eventId: string;
  changeId: string;
  stateVersion: number;
  timestamp: string;
  type:
    | 'delivery.prepared'
    | 'delivery.decided'
    | 'delivery.action'
    | 'delivery.refreshed'
    | 'delivery.invalidated';
  data: Record<string, unknown>;
}

export interface DeliveryStorePort {
  load(changeId: string): Promise<DeliveryState | null>;
  list(): Promise<DeliveryState[]>;
  commit(options: {
    state: DeliveryState;
    previousStateVersion: number | null;
    event: DeliveryEvent;
  }): Promise<void>;
  history(changeId: string): Promise<DeliveryEvent[]>;
  approvedEvidenceBundleIds(): Promise<string[]>;
}

export interface DeliveryV3StorePort {
  load(changeId: string): Promise<DeliveryStateV3 | null>;
  commit(options: {
    state: DeliveryStateV3;
    previousStateVersion: number | null;
    event: DeliveryEvent;
  }): Promise<void>;
}

export interface DeliveryEvidencePort {
  assertSatisfied(bundleIds: readonly string[], compositionDigest: string): Promise<void>;
}

export interface DeliveryTelemetryPort {
  export(state: DeliveryState, event: DeliveryEvent): Promise<void>;
}

export interface DeliveryGitPort {
  checkpoint(
    repository: RepositorySnapshot,
    intent: DeliveryRepositoryIntent,
    policy: DeliveryPolicy,
  ): Promise<CheckpointResult>;
  inspect(
    repository: RepositorySnapshot,
    intent: DeliveryRepositoryIntent,
    policy: DeliveryPolicy,
  ): Promise<DeliveryRepositoryFacts>;
  push(
    repository: RepositorySnapshot,
    action: PublicationAction,
    policy: DeliveryPolicy,
  ): Promise<string>;
}

export interface MergeRequestInput {
  repositoryId: string;
  remoteIdentity: string;
  sourceBranch: string;
  targetBranch: string;
  title: string;
  body: string;
}

export interface MergeRequestPort {
  capability(remoteIdentity: string, targetBranch: string): Promise<PlatformCapability>;
  find(input: MergeRequestInput): Promise<MergeRequestIdentity | null>;
  create(input: MergeRequestInput): Promise<MergeRequestIdentity>;
  update(identity: MergeRequestIdentity, input: MergeRequestInput): Promise<MergeRequestIdentity>;
  status(identity: MergeRequestIdentity): Promise<MergeRequestStatus>;
}

/**
 * Final Change publication needs every MR with the same repository/head/base tuple,
 * including closed MRs. A single-result lookup cannot distinguish safe recovery from
 * an ambiguous or previously closed publication attempt.
 */
export interface FinalMergeRequestPort extends MergeRequestPort {
  findAll(input: MergeRequestInput): Promise<MergeRequestIdentity[]>;
}

export interface CredentialProvider {
  token(): Promise<string>;
}
