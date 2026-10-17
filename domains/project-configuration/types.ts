import type { DeliveryPolicy } from '../delivery/types.js';

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

export type EvidenceNodeConfig = CommandNodeConfig;

export interface EvidenceProfileConfig {
  id: string;
  nodes: EvidenceNodeConfig[];
}

export interface SharedProjectConfig {
  apiVersion: typeof PROJECT_CONFIG_API_VERSION;
  kind: 'RepoctopusProject';
  project: { id: string };
  repositories: RepositoryConfig[];
  profiles: EvidenceProfileConfig[];
  evidence?: {
    retention?: {
      maxAgeDays?: number;
      minRecentSuccesses?: number;
    };
  };
  delivery?: Omit<DeliveryPolicy, 'apiVersion' | 'kind'>;
}

export interface LocalProjectConfig {
  apiVersion: typeof PROJECT_CONFIG_API_VERSION;
  kind: 'RepoctopusLocal';
  repositoryPaths?: Record<string, string>;
  ports?: Record<string, number>;
  browser?: { executablePath?: string };
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
