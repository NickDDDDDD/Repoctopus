import { createHash } from 'node:crypto';

import type { RunTriggerSnapshot } from '../engine/types.js';
import type { ProjectSnapshot } from '../project/types.js';
import { createProjectSnapshot } from '../project/snapshot.js';
import type { IdempotentStartWorkflowRunOptions } from '../runtime/workflow-runs.js';
import type { WorkflowPackage } from '../workflow-contract/types.js';
import type { PostMergeCoordinationResult } from './coordinator.js';
import type { PostMergeRepositoryFact } from './coordinator.js';
import type { MergeEvidence } from '../delivery/types.js';

export type PostMergeReady = Extract<PostMergeCoordinationResult, { status: 'ready' }>;

export interface PostMergeRunInput {
  coordination: PostMergeReady;
  workflow: WorkflowPackage;
  projectSnapshot: ProjectSnapshot;
  workflowSource?: string;
}

export interface PostMergeProjectSource {
  repositoryId: string;
  path: string;
}

export type PostMergeTriggerEvidence = Omit<MergeEvidence, 'observedAt'>;

export interface PostMergeTriggerFacts {
  changeId: string;
  mergeEvidence: PostMergeTriggerEvidence[];
  repositories: PostMergeRepositoryFact[];
}

function isRepositoryFact(value: unknown): value is PostMergeRepositoryFact {
  const item = value as Partial<PostMergeRepositoryFact> | null;
  return (
    !!item &&
    typeof item === 'object' &&
    typeof item.repositoryId === 'string' &&
    item.repositoryId.length > 0 &&
    typeof item.remoteIdentity === 'string' &&
    item.remoteIdentity.length > 0 &&
    typeof item.targetBranch === 'string' &&
    item.targetBranch.length > 0 &&
    typeof item.mergeCommit === 'string' &&
    /^[a-f0-9]{40,64}$/i.test(item.mergeCommit)
  );
}

function isMergeEvidence(value: unknown): value is PostMergeTriggerEvidence {
  const item = value as Partial<PostMergeTriggerEvidence> | null;
  return (
    !!item &&
    typeof item === 'object' &&
    typeof item.repositoryId === 'string' &&
    item.repositoryId.length > 0 &&
    typeof item.mergeCommit === 'string' &&
    /^[a-f0-9]{40,64}$/i.test(item.mergeCommit)
  );
}

function mergeEvidenceIdentity(value: PostMergeTriggerEvidence): string {
  return `${value.repositoryId}\0${value.mergeCommit.toLowerCase()}`;
}

export function postMergeTriggerFacts(
  trigger: RunTriggerSnapshot | undefined,
): PostMergeTriggerFacts {
  const facts = trigger?.facts as Partial<PostMergeTriggerFacts> | undefined;
  if (
    trigger?.schemaVersion !== 1 ||
    trigger.kind !== 'post-merge' ||
    !/^sha256:[a-f0-9]{64}$/.test(trigger.identityDigest) ||
    !facts ||
    typeof facts.changeId !== 'string' ||
    !Array.isArray(facts.mergeEvidence) ||
    !facts.mergeEvidence.every(isMergeEvidence) ||
    !Array.isArray(facts.repositories) ||
    facts.repositories.length === 0 ||
    !facts.repositories.every(isRepositoryFact) ||
    new Set(facts.repositories.map((repository) => repository.repositoryId)).size !==
      facts.repositories.length ||
    new Set(facts.mergeEvidence.map((evidence) => evidence.repositoryId)).size !==
      facts.mergeEvidence.length
  ) {
    throw new Error('Run has no valid Post-merge Trigger facts');
  }
  const evidence = new Set(facts.mergeEvidence.map(mergeEvidenceIdentity));
  if (
    evidence.size !== facts.repositories.length ||
    facts.repositories.some(
      (repository) =>
        !evidence.has(`${repository.repositoryId}\0${repository.mergeCommit.toLowerCase()}`),
    )
  ) {
    throw new Error('Run Post-merge Trigger repository facts do not match merge evidence');
  }
  return structuredClone(facts as PostMergeTriggerFacts);
}

export function postMergeRunId(changeId: string, mergeFactsDigest: `sha256:${string}`): string {
  if (!changeId.trim()) throw new Error('Post-merge change id is required');
  if (!/^sha256:[a-f0-9]{64}$/.test(mergeFactsDigest)) {
    throw new Error('Post-merge facts digest must be a sha256 digest');
  }
  const digest = createHash('sha256')
    .update(['post-merge/v1', changeId, mergeFactsDigest].join('\0'))
    .digest('hex');
  return `post-merge-${digest}`;
}

export function postMergeProjectSnapshot(input: {
  coordination: PostMergeReady;
  projectId: string;
  root: string;
  sources: PostMergeProjectSource[];
  capturedAt: string;
}): ProjectSnapshot {
  const sources = new Map(input.sources.map((source) => [source.repositoryId, source] as const));
  if (
    !input.projectId.trim() ||
    !input.root.trim() ||
    sources.size !== input.sources.length ||
    sources.size !== input.coordination.repositories.length
  ) {
    throw new Error('Post-merge project snapshot sources are incomplete');
  }
  const repositories = input.coordination.repositories.map((repository) => {
    const source = sources.get(repository.repositoryId);
    if (!source?.path.trim()) {
      throw new Error(`Post-merge project source is missing: ${repository.repositoryId}`);
    }
    return {
      id: repository.repositoryId,
      name: repository.repositoryId,
      path: source.path,
      remoteIdentity: repository.remoteIdentity,
      branch: repository.targetBranch,
      head: repository.mergeCommit,
      worktree: {
        dirty: false,
        digest: createHash('sha256')
          .update(
            ['post-merge-exact-checkout/v1', repository.repositoryId, repository.mergeCommit].join(
              '\0',
            ),
          )
          .digest('hex'),
        staged: 0,
        unstaged: 0,
        untracked: 0,
      },
    };
  });
  return createProjectSnapshot({
    schemaVersion: 1,
    projectId: input.projectId,
    root: input.root,
    capturedAt: input.capturedAt,
    repositories,
    diagnostics: [],
  });
}

export function postMergeRunOptions(input: PostMergeRunInput): IdempotentStartWorkflowRunOptions {
  if (input.workflow.definition.metadata.name !== 'post-merge') {
    throw new Error('Post-merge Run requires the post-merge workflow');
  }
  const trigger: RunTriggerSnapshot = {
    schemaVersion: 1,
    kind: 'post-merge',
    identityDigest: input.coordination.mergeFactsDigest,
    facts: {
      changeId: input.coordination.changeId,
      // Observation time describes a poll, not an authoritative merge fact. Keeping it out of
      // the durable Run identity lets a replay resume the same Run after a process interruption.
      mergeEvidence: input.coordination.mergeEvidence.map((evidence) =>
        structuredClone({
          repositoryId: evidence.repositoryId,
          mergeRequest: evidence.mergeRequest,
          mergeCommit: evidence.mergeCommit,
          mergedAt: evidence.mergedAt,
        }),
      ),
      repositories: structuredClone(input.coordination.repositories),
    },
  };
  postMergeTriggerFacts(trigger);
  return {
    workflow: input.workflow,
    projectSnapshot: input.projectSnapshot,
    runId: postMergeRunId(input.coordination.changeId, input.coordination.mergeFactsDigest),
    ...(input.workflowSource ? { workflowSource: input.workflowSource } : {}),
    trigger,
  };
}
