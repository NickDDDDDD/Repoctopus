import type { DeliveryPolicy } from '../delivery/types.js';
import type { BrowserJourney } from '../feedback/browser.js';
import type { ReadinessCondition } from '../feedback/service.js';

export const PROJECT_CONFIG_API_VERSION = 'repoctopus/v1alpha1' as const;

export interface RepositoryConfig {
  id: string;
  path: string;
}

export interface CommandNodeConfig {
  id: string;
  type: 'command';
  repository: string;
  dependsOn: string[];
  required: boolean;
  executable: string;
  args: string[];
  cwd?: string;
  timeoutMs: number;
  cache: boolean;
  cacheTtlMs?: number;
  zeroTests?: 'ignore' | 'warning' | 'blocking';
}

interface EvidenceNodeBase {
  id: string;
  repository: string;
  dependsOn: string[];
  required: boolean;
}

export interface ManagedServiceNodeConfig extends EvidenceNodeBase {
  type: 'service';
  mode: 'managed';
  executable: string;
  args: string[];
  cwd?: string;
  readiness: ReadinessCondition[];
  startupTimeoutMs: number;
  probeIntervalMs?: number;
  resourceKeys?: string[];
}

export interface AttachedServiceNodeConfig extends EvidenceNodeBase {
  type: 'service';
  mode: 'attached';
  readiness: ReadinessCondition[];
  startupTimeoutMs: number;
  probeIntervalMs?: number;
  buildIdentity?: { url: string; jsonPath: string };
}

export type ServiceNodeConfig = ManagedServiceNodeConfig | AttachedServiceNodeConfig;

export interface BrowserNodeConfig extends EvidenceNodeBase {
  type: 'browser';
  source: 'managed' | 'system';
  journey: BrowserJourney;
}

export interface VisualNodeConfig extends EvidenceNodeBase {
  type: 'visual';
  changeId: string;
  browserNode: string;
  pageUrl: string;
  criteria: Array<{ id: string; text: string; sourceRef?: string }>;
}

export interface SpecificationNodeConfig extends EvidenceNodeBase {
  type: 'specification';
  changeId: string;
  strict: boolean;
}

export type EvidenceNodeConfig =
  | CommandNodeConfig
  | ServiceNodeConfig
  | BrowserNodeConfig
  | VisualNodeConfig
  | SpecificationNodeConfig;

export interface EvidenceProfileConfig {
  id: string;
  nodes: EvidenceNodeConfig[];
}

export interface TeamPluginConfig {
  id: string;
  descriptor: string;
  module: string;
  config?: unknown;
}

export interface CredentialReference {
  provider: 'environment';
  variable: string;
}

export interface CapabilityProviderReference {
  id: string;
}

export interface PlatformEventsConfig {
  storeProvider: CapabilityProviderReference;
  http: {
    hostname: string;
    port: number;
    shutdownTimeoutMs: number;
  };
  github: {
    source: string;
    path: string;
    maxBodyBytes: number;
    webhookCredential: CredentialReference;
    apiCredential: CredentialReference;
  };
  runner: {
    identity: string;
    leaseMs: number;
    pollIntervalMs: number;
    retryDelayMs: number;
    maxAttempts: number;
    shutdownTimeoutMs: number;
  };
}

export interface PostMergeConfig {
  runnerIdentity: string;
  temporaryRoot: string;
  evidenceProfile: string;
  allowedWorkspacePaths: {
    specificationClosure: true;
    verificationPathPrefixes: string[];
  };
  publication: {
    operations: ['merge_target', 'commit', 'push', 'merge_request.create_or_recover'];
    remote: string;
    commit: {
      message: string;
      authorNameCredential: CredentialReference;
      authorEmailCredential: CredentialReference;
    };
    finalChangeMergeRequest: {
      title: string;
      body: string;
    };
  };
}

export interface SharedProjectConfig {
  apiVersion: typeof PROJECT_CONFIG_API_VERSION;
  kind: 'RepoctopusWorkspace';
  workspace: { id: string; repositoryId: string };
  repositories: RepositoryConfig[];
  profiles: EvidenceProfileConfig[];
  composition?: { plugins: TeamPluginConfig[] };
  evidence?: {
    retention?: {
      maxAgeDays?: number;
      minRecentSuccesses?: number;
    };
  };
  delivery?: Omit<DeliveryPolicy, 'apiVersion' | 'kind'>;
  skillProviders?: CapabilityProviderReference[];
  specificationProvider?: CapabilityProviderReference;
  platformEvents?: PlatformEventsConfig;
  postMerge?: PostMergeConfig;
}

export interface LocalProjectConfig {
  apiVersion: typeof PROJECT_CONFIG_API_VERSION;
  kind: 'RepoctopusLocal';
  repositoryPaths?: Record<string, string>;
  ports?: Record<string, number>;
  browser?: { executablePath?: string };
  visual?: {
    exchangeDirectory: string;
    responseTimeoutMs?: number;
  };
  resources?: {
    maxParallel?: number;
    maxLogBytes?: number;
  };
}

export interface EffectiveProjectConfig {
  shared: SharedProjectConfig;
  local: LocalProjectConfig | null;
  repositories: Array<RepositoryConfig & { resolvedPath: string }>;
  sharedDigest: string;
  localDigest: string | null;
  effectiveDigest: string;
}
