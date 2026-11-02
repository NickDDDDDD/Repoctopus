import { createHash } from 'node:crypto';

import { canonicalJson, canonicalValue } from '../workflow-contract/canonical.js';

export interface DirtyFileFingerprint {
  path: string;
  kind: 'file' | 'symlink' | 'deleted';
  sha256: string;
  size: number;
}

export interface ControlPlaneFileFingerprint extends DirtyFileFingerprint {
  kind: 'file';
  owner: string;
  ruleId: string;
}

export interface ControlPlaneInputFingerprint {
  digest: `sha256:${string}`;
  files: ControlPlaneFileFingerprint[];
}

export interface RepositoryFingerprint {
  repositoryId: string;
  head: string;
  tree: string;
  dirtyFiles: DirtyFileFingerprint[];
  inputPolicyDigest: `sha256:${string}`;
  controlPlane: ControlPlaneInputFingerprint;
}

export interface EvidenceFingerprintManifest {
  schemaVersion: 2;
  profileId: string;
  sharedConfigDigest: string;
  localConfigDigest: string | null;
  repositories: RepositoryFingerprint[];
  tools: Record<string, string>;
  adapters: Record<string, string>;
  browser?: { name: string; version: string; revision?: string };
  journeyDigest?: string;
  inputArtifactDigests: string[];
}

export interface EvidenceFingerprint {
  algorithm: 'sha256';
  digest: string;
  manifest: EvidenceFingerprintManifest;
}

function normalizedManifest(manifest: EvidenceFingerprintManifest): EvidenceFingerprintManifest {
  return {
    ...structuredClone(manifest),
    repositories: manifest.repositories
      .map((repository) => ({
        ...repository,
        dirtyFiles: [...repository.dirtyFiles].sort((left, right) =>
          left.path.localeCompare(right.path),
        ),
        controlPlane: {
          ...repository.controlPlane,
          files: [...repository.controlPlane.files].sort((left, right) =>
            left.path.localeCompare(right.path),
          ),
        },
      }))
      .sort((left, right) => left.repositoryId.localeCompare(right.repositoryId)),
    inputArtifactDigests: [...manifest.inputArtifactDigests].sort(),
  };
}

export function createEvidenceFingerprint(
  manifest: EvidenceFingerprintManifest,
): EvidenceFingerprint {
  const normalized = normalizedManifest(manifest);
  return {
    algorithm: 'sha256',
    digest: createHash('sha256')
      .update(canonicalJson(canonicalValue(normalized)))
      .digest('hex'),
    manifest: normalized,
  };
}
