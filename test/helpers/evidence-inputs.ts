import {
  createEvidenceDependencyRecord,
  type EvidenceDependencySubjectKind,
} from '../../domains/evidence/dependencies.js';
import {
  createEvidenceNodeInputSnapshot,
  evidenceInputDigest,
} from '../../domains/evidence/input-snapshot.js';
import { createArchiveDeliveryInput } from '../../domains/change-lifecycle/archive-input.js';
import { createVerificationInput } from '../../domains/change-lifecycle/verification-input.js';
import { createEvidenceFingerprint } from '../../domains/evidence/fingerprint.js';
import { parseSpecificationTasks } from '../../domains/specification/tasks.js';
import { TEST_COMPOSITION_DIGEST } from './fixtures.js';

export function verificationInputFixture(runId: string, checkEpoch = 0) {
  const node = {
    id: 'test',
    type: 'command' as const,
    repository: 'workspace',
    repositoryPath: '.',
    dependsOn: [],
    required: true,
    covers: ['*'],
    executable: 'node',
    args: [],
    timeoutMs: 1000,
    cache: false,
  };
  const plan = {
    schemaVersion: 1 as const,
    profileId: 'verify',
    configDigest: evidenceInputDigest('config'),
    nodes: [node],
    order: ['test'],
  };
  const fingerprint = createEvidenceFingerprint({
    schemaVersion: 3,
    profileId: 'verify',
    sharedConfigDigest: plan.configDigest,
    localConfigDigest: null,
    repositories: [
      {
        repositoryId: 'workspace',
        head: 'a'.repeat(40),
        tree: 'b'.repeat(40),
        dirtyFiles: [],
        inputPolicyDigest: evidenceInputDigest('policy'),
        controlPlane: { digest: evidenceInputDigest('control'), files: [] },
      },
    ],
    nodeInputs: [evidenceNodeInputFixture()],
    planningProjection: null,
    tools: { node: process.version },
    adapters: {},
    inputArtifactDigests: [],
  });
  return createVerificationInput({
    runId,
    checkEpoch,
    tasks: parseSpecificationTasks('recovery', '- [x] 1.1 Build.\n  **Acceptance:** It works\n')
      .tasks,
    fingerprint,
    plan,
    projectConfigDigest: evidenceInputDigest('config'),
    compositionDigest: TEST_COMPOSITION_DIGEST,
    skills: [
      {
        schemaVersion: 1,
        name: 'test-skill',
        provider: 'test',
        contentDigest: evidenceInputDigest('skill'),
        resourceManifestDigest: evidenceInputDigest('resources'),
        invocation: { modelInvocable: true, userInvocable: true },
      },
    ],
  });
}

export function createArchiveInputFixture(
  input: Omit<Parameters<typeof createArchiveDeliveryInput>[0], 'publicationCheckpoint'> &
    Partial<Pick<Parameters<typeof createArchiveDeliveryInput>[0], 'publicationCheckpoint'>>,
) {
  const repositories = [
    ...new Map(
      [
        {
          repositoryId: input.intent.changeBranch.repositoryId,
          sourceBranch: input.intent.changeBranch.sourceBranch,
        },
        ...input.intent.businessDeliveries,
      ].map((route) => [
        route.repositoryId,
        {
          repositoryId: route.repositoryId,
          head: 'a'.repeat(40),
          branch: route.sourceBranch,
          remoteIdentity: input.intent.changeBranch.remoteIdentity,
        },
      ]),
    ).values(),
  ].sort((a, b) => a.repositoryId.localeCompare(b.repositoryId));
  const facts = { schemaVersion: 1 as const, repositories };
  return createArchiveDeliveryInput({
    ...input,
    publicationCheckpoint: input.publicationCheckpoint ?? {
      ...facts,
      digest: evidenceInputDigest(facts),
    },
  });
}

export function evidenceDependencyFixture(
  subjectKind: EvidenceDependencySubjectKind,
  subjectId: string,
) {
  return createEvidenceDependencyRecord({
    subjectKind,
    subjectId,
    dependencies: [
      { partition: 'implementation-content', identity: evidenceInputDigest('test-input') },
    ],
  });
}

export function evidenceNodeInputFixture(nodeId = 'test') {
  return createEvidenceNodeInputSnapshot({
    node: {
      id: nodeId,
      type: 'command',
      repository: 'workspace',
      repositoryPath: '.',
      executable: 'node',
      args: [],
      dependsOn: [],
      required: true,
      cache: false,
      timeoutMs: 1000,
    },
    repositories: [],
    executionIdentity: 'test-adapter',
    environmentDigest: evidenceInputDigest([]),
    derivedFrom: [],
    outputs: [],
  });
}
