import type { SharedProjectConfig } from './types.js';

export type DetectionConfidence = 'confirmed' | 'inferred';

export interface DetectionSource {
  repositoryId: string;
  file: string;
  detail: string;
}

export interface DetectedCommand {
  id: string;
  repository: string;
  executable: string;
  args: string[];
  cwd: string;
  confidence: DetectionConfidence;
  sources: DetectionSource[];
  zeroTests?: 'warning' | 'blocking';
}

export interface DetectedService {
  id: string;
  repository: string;
  port?: number;
  healthEndpoint?: string;
  confidence: DetectionConfidence;
  sources: DetectionSource[];
}

export interface DetectedRepository {
  id: string;
  name: string;
  path: string;
  remoteIdentity: string | null;
  technologies: Array<'node' | 'maven' | 'gradle'>;
  commands: DetectedCommand[];
  services: DetectedService[];
  openSpec: OpenSpecRepositoryBinding;
}

export type OpenSpecRepositoryClassification =
  | 'workspace-store'
  | 'unconfigured'
  | 'same-store'
  | 'other-store'
  | 'local-authority'
  | 'damaged'
  | 'read-only';

export interface OpenSpecPointerDiff {
  path: 'openspec/config.yaml';
  before: string | null;
  after: string | null;
}

export interface OpenSpecRepositoryBinding {
  repositoryId: string;
  classification: OpenSpecRepositoryClassification;
  selection: 'install' | 'keep' | 'skip' | 'blocked';
  configuredStoreId: string | null;
  pointerDiff: OpenSpecPointerDiff | null;
  diagnostic: string | null;
}

export interface OpenSpecStoreBindingProposal {
  storeId: string;
  workspaceRepositoryId: string;
  workspaceRoot: string;
  repositories: OpenSpecRepositoryBinding[];
}

export interface DetectionUnresolvedItem {
  code:
    | 'unknown-build'
    | 'service-port'
    | 'health-endpoint'
    | 'command-review'
    | 'acceptance-coverage';
  repository: string;
  message: string;
  source?: DetectionSource;
}

export interface ProjectConfigReconcileDiff {
  changed: boolean;
  addedRepositories: string[];
  removedRepositories: string[];
  addedNodes: string[];
  removedNodes: string[];
  conflicts: Array<{ field: string; current: unknown; candidate: unknown }>;
}

export interface ProjectDetectionDraft {
  apiVersion: 'repoctopus/v1alpha1';
  kind: 'ProjectDetectionDraft';
  draftId: string;
  status: 'candidate' | 'awaiting_confirmation' | 'confirmed';
  capturedAt: string;
  scanRoot: string;
  workspace: string;
  repositories: DetectedRepository[];
  unresolved: DetectionUnresolvedItem[];
  candidateConfig: SharedProjectConfig | null;
  baseConfigDigest: string | null;
  reconcile: ProjectConfigReconcileDiff | null;
  storeBinding: OpenSpecStoreBindingProposal | null;
}
