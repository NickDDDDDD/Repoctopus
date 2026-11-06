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
  covers?: string[];
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
  covers?: string[];
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

export interface SpecificationProviderReference extends CapabilityProviderReference {
  store: {
    id: string;
    repositoryId: string;
  };
}

export type TeamSkillBindingRole = 'guidance' | 'augmentation-replacement';

export interface TeamSkillBindingConfig {
  id: string;
  target: string;
  role: TeamSkillBindingRole;
  skill: string;
  order: number;
  slot?: string;
}

export interface TeamSkillBindingsConfig {
  schemaVersion: 1;
  bindings: TeamSkillBindingConfig[];
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
  specificationProvider?: SpecificationProviderReference;
  lifecycle?: { skillBindings: TeamSkillBindingsConfig };
  telemetry?: { endpoint: string };
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
  /** Shared execution inputs. Use the full shared configuration hash for onboarding approval. */
  sharedDigest: string;
  localDigest: string | null;
  effectiveDigest: string;
}
