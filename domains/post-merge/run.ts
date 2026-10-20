import { createHash } from 'node:crypto';

import type { RunTriggerSnapshot } from '../engine/types.js';
import type { ProjectSnapshot } from '../project/types.js';
import type { IdempotentStartWorkflowRunOptions } from '../runtime/workflow-runs.js';
import type { WorkflowPackage } from '../workflow-contract/types.js';
import type { PostMergeCoordinationResult } from './coordinator.js';
import type { PostMergeRepositoryFact } from './coordinator.js';

export type PostMergeReady = Extract<PostMergeCoordinationResult, { status: 'ready' }>;

export interface PostMergeRunInput {
  coordination: PostMergeReady;
  workflow: WorkflowPackage;
  projectSnapshot: ProjectSnapshot;
  workflowSource?: string;
}

export interface PostMergeTriggerFacts {
  changeId: string;
  mergeEvidence: PostMergeReady['mergeEvidence'];
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

function isMergeEvidence(value: unknown): value is PostMergeReady['mergeEvidence'][number] {
  const item = value as Partial<PostMergeReady['mergeEvidence'][number]> | null;
  return (
    !!item &&
    typeof item === 'object' &&
    typeof item.repositoryId === 'string' &&
    item.repositoryId.length > 0 &&
    typeof item.mergeCommit === 'string' &&
    /^[a-f0-9]{40,64}$/i.test(item.mergeCommit)
  );
}

function mergeEvidenceIdentity(value: PostMergeReady['mergeEvidence'][number]): string {
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
      mergeEvidence: structuredClone(input.coordination.mergeEvidence),
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
