import type { EvidenceInputProofPort, ArtifactStore } from '../../domains/evidence/ports.js';
import type { EvidenceExecutionPlan } from '../../domains/feedback/profile.js';
import type { EffectiveProjectConfig } from '../../domains/project-configuration/types.js';
import type {
  ArtifactRef,
  EvidenceReceipt,
  EvidenceDerivedInput,
} from '../../domains/evidence/types.js';
import type { DirtyFileFingerprint } from '../../domains/evidence/fingerprint.js';
import {
  evidenceInputDigest,
  type EvidenceNodeInputSnapshot,
  type EvidenceOutputClaim,
} from '../../domains/evidence/input-snapshot.js';
import { matchesEvidenceInputPath } from '../../domains/evidence/input-policy.js';
import { canonicalJson } from '../../domains/workflow-contract/canonical.js';
import { collectEvidenceInputFiles } from '../git/evidence-input-snapshot.js';

interface OutputManifest {
  schemaVersion: 1;
  producerId: string;
  repositories: {
    repositoryId: string;
    patterns: readonly string[];
    files: DirtyFileFingerprint[];
  }[];
}

/** Immutable manifests are written before node.completed, never restored into a checkout. */
export class FileEvidenceInputProofs implements EvidenceInputProofPort {
  constructor(
    private readonly config: EffectiveProjectConfig,
    private readonly plan: EvidenceExecutionPlan,
    private readonly artifacts: ArtifactStore,
  ) {}

  private async capture(claims: readonly EvidenceOutputClaim[]): Promise<OutputManifest> {
    if (!claims.length) throw new Error('Output manifest requires an owned producer scope');
    const repositories = await Promise.all(
      claims.map(async (claim) => {
        const repo = this.config.repositories.find((repo) => repo.id === claim.repositoryId);
        if (!repo) throw new Error('Output manifest repository is not registered');
        const files = await collectEvidenceInputFiles({
          root: repo.resolvedPath,
          files: claim.patterns,
        });
        if (files.some((file) => file.kind !== 'file'))
          throw new Error('Evidence outputs must be regular files');
        return { repositoryId: claim.repositoryId, patterns: claim.patterns, files };
      }),
    );
    return { schemaVersion: 1, producerId: claims[0]!.producerId, repositories };
  }

  private async load(reference: ArtifactRef): Promise<OutputManifest> {
    if (reference.artifactType !== 'evidence-output-manifest')
      throw new Error('Invalid Evidence output artifact type');
    const value = JSON.parse(
      Buffer.from(await this.artifacts.read(reference)).toString('utf8'),
    ) as OutputManifest;
    if (value.schemaVersion !== 1 || !value.producerId || !Array.isArray(value.repositories))
      throw new Error('Invalid Evidence output manifest');
    return value;
  }

  async captureOutputs(snapshot: EvidenceNodeInputSnapshot): Promise<ArtifactRef | null> {
    if (!snapshot.outputs.length) return null;
    const manifest = await this.capture(snapshot.outputs);
    return this.artifacts.put(canonicalJson(manifest), {
      artifactType: 'evidence-output-manifest',
      mediaType: 'application/json',
      redacted: true,
    });
  }

  async outputsCurrent(
    snapshot: EvidenceNodeInputSnapshot,
    receipt: EvidenceReceipt,
  ): Promise<boolean> {
    if (!snapshot.outputs.length) return receipt.outputManifest === null;
    if (!receipt.outputManifest) return false;
    const expected = await this.load(receipt.outputManifest);
    const current = await this.capture(snapshot.outputs);
    return canonicalJson(expected) === canonicalJson(current);
  }

  async captureDerived(
    snapshot: EvidenceNodeInputSnapshot,
    predecessors: ReadonlyMap<string, EvidenceReceipt>,
  ): Promise<EvidenceDerivedInput[]> {
    const proofs: EvidenceDerivedInput[] = [];
    const node = this.plan.nodes.find((node) => node.id === snapshot.nodeId)!;
    for (const producerId of [
      ...new Set(snapshot.derivedFrom.map((claim) => claim.producerId)),
    ].sort()) {
      const producer = predecessors.get(producerId);
      if (!producer || producer.status !== 'passed' || !producer.outputManifest)
        throw new Error('Derived input has no committed producer manifest');
      const claims = snapshot.derivedFrom.filter((claim) => claim.producerId === producerId);
      const expected = await this.load(producer.outputManifest);
      const actual = await this.capture(claims);
      if (canonicalJson(expected) !== canonicalJson(actual))
        throw new Error('Derived output changed after its producer completed');
      const selected = actual.repositories.map((repo) => {
        const scope =
          node.type === 'command'
            ? node.inputs?.repositories?.find((scope) => scope.repository === repo.repositoryId)
            : undefined;
        return {
          ...repo,
          files: repo.files.filter(
            (file) =>
              !scope?.files ||
              scope.files.some((pattern) => matchesEvidenceInputPath(pattern, file.path)),
          ),
        };
      });
      proofs.push({
        producerId,
        producerReceiptId: producer.receiptId,
        manifest: producer.outputManifest,
        contentDigest: evidenceInputDigest(selected),
      });
    }
    return proofs;
  }
}
