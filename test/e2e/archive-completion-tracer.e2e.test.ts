import { describe, expect, it, vi } from 'vitest';

import {
  createArchiveDeliveryInput,
  type ArchiveDeliveryInput,
} from '../../domains/change-lifecycle/archive-input.js';
import {
  ArchiveCompletionTracer,
  type ArchiveTracerPorts,
} from '../../domains/change-lifecycle/archive-tracer.js';
import {
  BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
  createChangeLifecycleSnapshot,
} from '../../domains/change-lifecycle/definition.js';
import type { PublicationReceiptItem } from '../../domains/delivery/publication-receipt.js';
import type { DeliveryIntentV3, DeliveryPolicy } from '../../domains/delivery/types.js';
import type { SpecificationClosureResult } from '../../domains/specification/types.js';

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const oid = (character: string) => character.repeat(40);
const policy: DeliveryPolicy = {
  apiVersion: 'repoctopus/v1alpha1',
  kind: 'DeliveryPolicy',
  checkpoint: {
    automatic: false,
    protectedBranches: ['main'],
    commitMessagePattern: '.+',
    quickChecks: {},
  },
  publication: {
    remote: 'origin',
    provider: 'github',
    githubApiBaseUrl: 'https://api.github.com',
    mrTitleTemplate: '{{changeId}}',
    mrBodyTemplate: '{{verificationReport}}',
  },
};
const intent: DeliveryIntentV3 = {
  schemaVersion: 3,
  changeId: 'single-tracer',
  changeBranch: {
    repositoryId: 'workspace',
    remoteIdentity: 'team/workspace',
    sourceBranch: 'spec/single-tracer',
    targetBranch: 'main',
    remoteOid: oid('a'),
  },
  businessDeliveries: [
    {
      deliveryId: 'app',
      repositoryId: 'app',
      sourceBranch: 'feature/single-tracer',
      targetBranch: 'main',
      commitMessage: 'feat: tracer',
      actions: ['push', 'merge_request'],
    },
  ],
};

function publication(
  role: PublicationReceiptItem['role'],
  provenance: PublicationReceiptItem['provenance'],
): PublicationReceiptItem {
  const specification = role === 'specification';
  return {
    publicationId: role,
    role,
    ...(specification ? {} : { deliveryId: 'app' }),
    repositoryId: specification ? 'workspace' : 'app',
    remoteIdentity: specification ? 'team/workspace' : 'team/app',
    remote: 'origin',
    sourceBranch: specification ? 'spec/single-tracer' : 'feature/single-tracer',
    targetBranch: 'main',
    publishedOid: oid(specification ? 'c' : 'b'),
    mergeRequest: {
      provider: 'github',
      repositoryId: specification ? 'workspace' : 'app',
      number: specification ? 12 : 11,
      url: `https://github.com/team/${specification ? 'workspace' : 'app'}/pull/${specification ? 12 : 11}`,
    },
    provenance,
    verifiedAt: '2026-10-24T00:00:00.000Z',
  };
}

function fixture(provenance: PublicationReceiptItem['provenance']) {
  const calls: string[] = [];
  const ports: ArchiveTracerPorts = {
    closeSpecification: vi.fn(
      async (archive: ArchiveDeliveryInput): Promise<SpecificationClosureResult> => {
        calls.push('openspec archive --yes --json');
        return {
          apiVersion: 'repoctopus.specification/v1alpha1',
          kind: 'SpecificationClosureResult',
          changeId: archive.changeId,
          provider: {
            id: 'openspec',
            version: '1.14.3',
            protocolVersion: 'repoctopus.specification/v1alpha1',
          },
          planDigest: digest('d'),
          closureId: digest('e'),
          status: 'closed',
          archiveId: '2026-10-24-single-tracer',
          changedFiles: ['openspec/changes/archive/2026-10-24-single-tracer/proposal.md'],
        };
      },
    ),
    publishBusiness: vi.fn(async () => {
      calls.push('git push business; create-or-adopt business MR; verify head/base/OID');
      const item = publication('business', provenance);
      return {
        deliverySnapshotDigest: digest('f'),
        items: [{ item, expectedPublishedOid: item.publishedOid }],
      };
    }),
    publishSpecification: vi.fn(async () => {
      calls.push('git push specification; create-or-adopt final MR; verify head/base/OID');
      const item = publication('specification', provenance);
      return { item, expectedPublishedOid: item.publishedOid };
    }),
  };
  return { ports, calls };
}

describe('single-repository Archive production tracer', () => {
  it.each(['runtime-created', 'human-created'] as const)(
    'finishes from %s MRs without listeners, merge polling, or Post-merge workflow',
    async (provenance) => {
      const archive = createArchiveDeliveryInput({
        runId: 'run-tracer',
        changeId: 'single-tracer',
        verificationInputDigest: digest('1'),
        acceptedEvidenceBundleIds: ['bundle'],
        evidenceBundleId: 'bundle',
        verificationReport: {
          apiVersion: 'repoctopus/v1alpha1',
          kind: 'ArtifactRef',
          sha256: '2'.repeat(64),
          size: 100,
          mediaType: 'application/json',
          artifactType: 'verification-report',
          redacted: true,
        },
        intent,
        policy,
      });
      const current = {
        ...createChangeLifecycleSnapshot({
          identity: {
            workspaceId: 'team',
            changeId: 'single-tracer',
            generation: 1,
            runId: 'run-tracer',
          },
        }),
        phase: 'archive' as const,
        status: 'running' as const,
        verificationInput: {
          schemaVersion: 1 as const,
          runId: 'run-tracer',
          taskRevisions: [],
          repositories: [],
          projectConfigDigest: digest('3'),
          compositionDigest: digest('4'),
          skills: [],
          evidenceProfile: {
            id: 'verify',
            planDigest: digest('5'),
            fingerprintDigest: digest('6'),
          },
          digest: digest('1'),
        },
      };
      const { ports, calls } = fixture(provenance);
      const result = await new ArchiveCompletionTracer(ports).trace({
        definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
        current,
        archive,
        actionSkill: {
          schemaVersion: 1,
          name: 'pr',
          provider: 'matt-builtins',
          invocation: { modelInvocable: true, userInvocable: true },
          contentDigest: digest('7'),
          resourceManifestDigest: digest('8'),
        },
        workspaceRepositoryId: 'workspace',
        repositoryIds: ['workspace', 'app'],
      });
      expect(calls).toEqual([
        'openspec archive --yes --json',
        'git push business; create-or-adopt business MR; verify head/base/OID',
        'git push specification; create-or-adopt final MR; verify head/base/OID',
      ]);
      expect(result.snapshot.status).toBe('completed');
      expect(result.receipt.items.map((item) => item.provenance)).toEqual([provenance, provenance]);
      expect(JSON.stringify(result)).not.toMatch(/webhook|listener|post-merge|mergedAt/u);
    },
  );
});
