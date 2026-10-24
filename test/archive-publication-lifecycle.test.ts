import { afterEach, describe, expect, it } from 'vitest';

import {
  createArchiveDeliveryInput,
  createDeliveryPublishWork,
  createSpecificationCloseWork,
} from '../domains/change-lifecycle/archive-input.js';
import {
  BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
  createChangeLifecycleSnapshot,
} from '../domains/change-lifecycle/definition.js';
import { evolveChangeLifecycle } from '../domains/change-lifecycle/transition.js';
import {
  createPublicationReceipt,
  PUBLICATION_RECEIPT_API_VERSION,
} from '../domains/delivery/publication-receipt.js';
import type { DeliveryIntentV3, DeliveryPolicy } from '../domains/delivery/types.js';
import type { SkillUsageSnapshot } from '../domains/skill/types.js';
import type { SpecificationClosureResult } from '../domains/specification/types.js';
import { WorkflowRunCoordinator } from '../domains/runtime/workflow-runs.js';
import { FileRuntimeStore } from '../platform/runtime/file-runtime-store.js';
import {
  compositionFixture,
  projectFixture,
  removeTemporaryDirectory,
  temporaryDirectory,
  workflowFixture,
} from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;

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
  changeId: 'terminal-archive',
  changeBranch: {
    repositoryId: 'workspace',
    remoteIdentity: 'team/workspace',
    sourceBranch: 'spec/terminal-archive',
    targetBranch: 'main',
    remoteOid: 'a'.repeat(40),
  },
  businessDeliveries: [
    {
      deliveryId: 'primary',
      repositoryId: 'app',
      sourceBranch: 'feature/terminal-archive',
      targetBranch: 'main',
      commitMessage: 'feat: terminal archive',
      actions: ['push', 'merge_request'],
    },
  ],
};

const prSkill: SkillUsageSnapshot = {
  schemaVersion: 1,
  name: 'pr',
  provider: 'matt-builtins',
  invocation: { modelInvocable: true, userInvocable: true },
  contentDigest: digest('1'),
  resourceManifestDigest: digest('2'),
};

function archiveState() {
  const archive = createArchiveDeliveryInput({
    runId: 'run-terminal',
    changeId: 'terminal-archive',
    verificationInputDigest: digest('3'),
    acceptedEvidenceBundleIds: ['bundle-1'],
    evidenceBundleId: 'bundle-1',
    verificationReport: {
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'ArtifactRef',
      sha256: '4'.repeat(64),
      size: 64,
      mediaType: 'application/json',
      artifactType: 'verification-report',
      redacted: true,
    },
    intent,
    policy,
  });
  const initial = {
    ...createChangeLifecycleSnapshot({
      identity: {
        workspaceId: 'team',
        changeId: 'terminal-archive',
        generation: 2,
        runId: 'run-terminal',
      },
    }),
    phase: 'archive' as const,
    status: 'running' as const,
    verificationInput: {
      schemaVersion: 1 as const,
      runId: 'run-terminal',
      taskRevisions: [],
      repositories: [],
      projectConfigDigest: digest('5'),
      compositionDigest: digest('6'),
      skills: [],
      evidenceProfile: {
        id: 'verification',
        planDigest: digest('7'),
        fingerprintDigest: digest('8'),
      },
      digest: digest('3'),
    },
  };
  const closeWork = createSpecificationCloseWork({
    definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
    archive,
    workspaceRepositoryId: 'workspace',
    repositoryIds: ['workspace', 'app'],
  });
  const preflight = evolveChangeLifecycle({
    definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
    current: initial,
    observation: { kind: 'archive-preflight-ready', archiveInput: archive, work: closeWork },
  });
  const closure: SpecificationClosureResult = {
    apiVersion: 'repoctopus.specification/v1alpha1',
    kind: 'SpecificationClosureResult',
    changeId: 'terminal-archive',
    provider: {
      id: 'openspec',
      version: '1.14.3',
      protocolVersion: 'repoctopus.specification/v1alpha1',
    },
    planDigest: digest('9'),
    closureId: digest('a'),
    status: 'closed',
    archiveId: '2026-10-24-terminal-archive',
    changedFiles: ['openspec/changes/archive/2026-10-24-terminal-archive/proposal.md'],
  };
  const publishWork = createDeliveryPublishWork({
    definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
    archive,
    closure,
    actionSkill: prSkill,
    workspaceRepositoryId: 'workspace',
    repositoryIds: ['workspace', 'app'],
  });
  const closed = evolveChangeLifecycle({
    definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
    current: preflight.snapshot,
    observation: { kind: 'archive-specification-closed', closure, work: publishWork },
  });
  const receipt = createPublicationReceipt({
    apiVersion: PUBLICATION_RECEIPT_API_VERSION,
    kind: 'PublicationReceipt',
    schemaVersion: 1,
    changeId: 'terminal-archive',
    generation: 2,
    runId: 'run-terminal',
    deliverySnapshotDigest: digest('b'),
    verificationInputDigest: digest('3'),
    evidenceBundleIds: ['bundle-1'],
    specificationClosure: { closureId: closure.closureId, planDigest: closure.planDigest },
    items: [
      {
        publicationId: 'business-primary',
        role: 'business',
        deliveryId: 'primary',
        repositoryId: 'app',
        remoteIdentity: 'team/app',
        remote: 'origin',
        sourceBranch: 'feature/terminal-archive',
        targetBranch: 'main',
        publishedOid: 'c'.repeat(40),
        mergeRequest: {
          provider: 'github',
          repositoryId: 'app',
          number: 41,
          url: 'https://github.com/team/app/pull/41',
        },
        provenance: 'runtime-created',
        verifiedAt: '2026-10-24T00:00:00.000Z',
      },
      {
        publicationId: 'specification',
        role: 'specification',
        repositoryId: 'workspace',
        remoteIdentity: 'team/workspace',
        remote: 'origin',
        sourceBranch: 'spec/terminal-archive',
        targetBranch: 'main',
        publishedOid: 'd'.repeat(40),
        mergeRequest: {
          provider: 'github',
          repositoryId: 'workspace',
          number: 42,
          url: 'https://github.com/team/workspace/pull/42',
        },
        provenance: 'human-created',
        verifiedAt: '2026-10-24T00:00:00.000Z',
      },
    ],
  });
  return { closed: closed.snapshot, receipt };
}

describe('Archive publication terminal lifecycle', () => {
  it.each(['open', 'merged', 'closed'] as const)(
    'completes from a full receipt without consulting an MR in %s state',
    () => {
      const { closed, receipt } = archiveState();
      const result = evolveChangeLifecycle({
        definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
        current: closed,
        observation: { kind: 'archive-publication-receipt-accepted', receipt },
      });
      expect(result.snapshot).toMatchObject({
        phase: 'archive',
        status: 'completed',
        currentWork: null,
        publicationReceipt: { digest: receipt.digest },
      });
      const repeated = evolveChangeLifecycle({
        definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
        current: result.snapshot,
        observation: { kind: 'archive-publication-receipt-accepted', receipt },
      });
      expect(repeated).toEqual({ snapshot: result.snapshot, fact: null });
    },
  );

  it('blocks when the publication receipt is missing and rejects an incomplete receipt', () => {
    const { closed, receipt } = archiveState();
    const blocked = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: closed,
      observation: {
        kind: 'archive-publication-blocked',
        reason: 'Specification publication was not observed',
        evidenceIds: ['publication:specification'],
      },
    });
    expect(blocked.snapshot).toMatchObject({
      status: 'blocked',
      currentWork: { kind: 'delivery.publish' },
      blocker: { code: 'publication-receipt-incomplete' },
    });
    expect(() =>
      createPublicationReceipt({
        ...receipt,
        items: receipt.items.filter((item) => item.role === 'business'),
      }),
    ).toThrow(/Business and Specification publications/u);
  });

  it('persists the closure and Publication Receipt as the completed Run authority', async () => {
    const workspace = await temporaryDirectory('repoctopus-archive-receipt-');
    cleanup.push(workspace);
    const store = new FileRuntimeStore(workspace);
    const runtime = new WorkflowRunCoordinator(
      store,
      { export: () => Promise.resolve() },
      compositionFixture(),
    );
    const { closed, receipt } = archiveState();
    await runtime.start({
      workflow: workflowFixture(),
      projectSnapshot: projectFixture(),
      runId: closed.identity.runId,
      changeLifecycle: closed,
    });

    await runtime.acceptChangeObservation(closed.identity.runId, {
      kind: 'archive-publication-receipt-accepted',
      receipt,
    });

    const persisted = await store.loadRun(closed.identity.runId);
    expect(persisted).toMatchObject({
      status: 'completed',
      changeLifecycle: {
        specificationClosure: { closureId: receipt.specificationClosure.closureId },
        publicationReceipt: { digest: receipt.digest },
      },
    });
    expect((await runtime.status(closed.identity.runId)).changeLifecycle).toMatchObject({
      status: 'completed',
      publicationReceipt: { digest: receipt.digest },
    });
  });
});
