import { createHash } from 'node:crypto';

import type { RunTriggerSnapshot } from '../engine/types.js';
import type { ProjectSnapshot } from '../project/types.js';
import type { IdempotentStartWorkflowRunOptions } from '../runtime/workflow-runs.js';
import type { WorkflowPackage } from '../workflow-contract/types.js';
import type { PostMergeCoordinationResult } from './coordinator.js';

export type PostMergeReady = Extract<PostMergeCoordinationResult, { status: 'ready' }>;

export interface PostMergeRunInput {
  coordination: PostMergeReady;
  workflow: WorkflowPackage;
  projectSnapshot: ProjectSnapshot;
  workflowSource?: string;
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
    },
  };
  return {
    workflow: input.workflow,
    projectSnapshot: input.projectSnapshot,
    runId: postMergeRunId(input.coordination.changeId, input.coordination.mergeFactsDigest),
    ...(input.workflowSource ? { workflowSource: input.workflowSource } : {}),
    trigger,
  };
}
