import { createHash } from 'node:crypto';
import type { EvidenceExecutionPlan, PlannedEvidenceNode } from '../feedback/profile.js';
import type { SpecificationEvidenceProjection } from '../specification/types.js';
import { canonicalJson } from '../workflow-contract/canonical.js';
import type { EvidenceDependency } from './dependencies.js';
import type { DirtyFileFingerprint } from './fingerprint.js';
import {
  DEFAULT_EVIDENCE_INPUT_POLICY,
  matchesEvidenceInputPath,
  evidenceInputPatternsOverlap,
  type EvidenceInputPolicy,
} from './input-policy.js';

export function evidenceInputDigest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export interface EvidenceOutputClaim {
  producerId: string;
  repositoryId: string;
  patterns: readonly string[];
}

export interface EvidenceNodeInputSnapshot {
  schemaVersion: 1;
  nodeId: string;
  predecessorNodeIds: readonly string[];
  cacheable: boolean;
  policy: EvidenceInputPolicy;
  repositories: readonly { repositoryId: string; files: readonly DirtyFileFingerprint[] }[];
  derivedFrom: readonly EvidenceOutputClaim[];
  outputs: readonly EvidenceOutputClaim[];
  dependencies: readonly EvidenceDependency[];
  fingerprint: string;
}

export function evidenceOutputClaims(plan: EvidenceExecutionPlan): EvidenceOutputClaim[] {
  const claims = plan.nodes.flatMap((node) =>
    node.type === 'command'
      ? (node.inputs?.repositories ?? [])
          .filter((repo) => repo.outputs.length)
          .map((repo) => ({
            producerId: node.id,
            repositoryId: repo.repository,
            patterns: repo.outputs,
          }))
      : [],
  );
  const overlap = evidenceInputPatternsOverlap;
  for (const [index, claim] of claims.entries()) {
    if (
      claims
        .slice(index + 1)
        .some(
          (other) =>
            other.repositoryId === claim.repositoryId &&
            claim.patterns.some((a) => other.patterns.some((b) => overlap(a, b))),
        )
    ) {
      throw new Error('Evidence output ownership overlaps');
    }
    const node = plan.nodes.find((candidate) => candidate.id === claim.producerId)!;
    if (
      node.type === 'command' &&
      node.inputs?.repositories?.some(
        (repo) =>
          repo.repository === claim.repositoryId &&
          repo.files?.some((a) => claim.patterns.some((b) => overlap(a, b))),
      )
    ) {
      throw new Error('Evidence explicit input and producer output scopes overlap');
    }
  }
  return claims;
}

export function evidenceNodeAncestors(
  plan: EvidenceExecutionPlan,
  node: PlannedEvidenceNode,
): Set<string> {
  const result = new Set<string>();
  const visit = (id: string) => {
    if (result.has(id)) return;
    result.add(id);
    plan.nodes.find((candidate) => candidate.id === id)!.dependsOn.forEach(visit);
  };
  node.dependsOn.forEach(visit);
  return result;
}

export function createEvidenceNodeInputSnapshot(input: {
  node: PlannedEvidenceNode;
  policy?: EvidenceInputPolicy;
  repositories: readonly { repositoryId: string; files: readonly DirtyFileFingerprint[] }[];
  projection?: SpecificationEvidenceProjection;
  executionIdentity: unknown;
  gitIdentity?: unknown;
  environmentDigest: `sha256:${string}`;
  cacheable?: boolean;
  derivedFrom: readonly EvidenceOutputClaim[];
  outputs: readonly EvidenceOutputClaim[];
}): EvidenceNodeInputSnapshot {
  const policy = input.policy ?? DEFAULT_EVIDENCE_INPUT_POLICY;
  const planning: EvidenceDependency[] = [];
  const repositories = input.repositories
    .map((repo) => ({
      repositoryId: repo.repositoryId,
      files: repo.files
        .map((inputFile) => {
          const { path, kind, sha256, size } = inputFile;
          const file: DirtyFileFingerprint = { path, kind, sha256, size };
          const projection =
            input.projection?.root.repositoryId === repo.repositoryId
              ? input.projection.files.find((entry) => entry.path === file.path)
              : undefined;
          if (!projection) return file;
          if (projection.rawDigest !== `sha256:${file.sha256}`)
            throw new Error('Specification Evidence projection does not match actual file bytes');
          const semanticDigest =
            policy.taskCheckboxes === 'ignore' ? projection.semanticDigest : projection.rawDigest;
          planning.push({
            partition: 'planning-semantic',
            identity: evidenceInputDigest({
              repositoryId: repo.repositoryId,
              path: file.path,
              semanticDigest,
              provider: input.projection!.provider,
              root: input.projection!.root,
              schema: input.projection!.schemaDigest,
              policy: input.projection!.policy,
            }),
          });
          // Size and raw digest are provenance; neither can reintroduce checkbox identity.
          return { ...file, sha256: semanticDigest.slice(7), size: 0 };
        })
        .sort((a, b) => a.path.localeCompare(b.path)),
    }))
    .sort((a, b) => a.repositoryId.localeCompare(b.repositoryId));
  const dependencies: EvidenceDependency[] = [
    { partition: 'implementation-content', identity: evidenceInputDigest(repositories) },
    {
      partition: 'execution-control',
      identity: evidenceInputDigest({
        node: {
          ...input.node,
          repositoryPath: undefined,
        },
        executionIdentity: input.executionIdentity,
        policy,
        env: input.environmentDigest,
        derivedFrom: input.derivedFrom,
        outputs: input.outputs,
      }),
    },
    ...planning,
    ...(policy.git === 'all'
      ? [{ partition: 'git-identity' as const, identity: evidenceInputDigest(input.gitIdentity) }]
      : []),
  ];
  const stable = {
    schemaVersion: 1 as const,
    nodeId: input.node.id,
    predecessorNodeIds: [...input.node.dependsOn].sort(),
    cacheable: input.cacheable ?? false,
    policy,
    repositories,
    derivedFrom: input.derivedFrom,
    outputs: input.outputs,
    dependencies,
  };
  return { ...stable, fingerprint: evidenceInputDigest(stable).slice(7) };
}

export function selectedDerivedFiles(
  claim: EvidenceOutputClaim,
  files: readonly DirtyFileFingerprint[],
): DirtyFileFingerprint[] {
  return files.filter((file) =>
    claim.patterns.some((pattern) => matchesEvidenceInputPath(pattern, file.path)),
  );
}
