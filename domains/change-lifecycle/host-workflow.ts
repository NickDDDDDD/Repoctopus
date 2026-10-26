import { createHash } from 'node:crypto';

import { createWorkflowPackage } from '../workflow-contract/package.js';
import type { WorkflowPackage } from '../workflow-contract/types.js';
import { prepareChangeLifecycleDefinition } from './definition.js';

export function changeRunId(input: { workspaceId: string; changeId: string }): string {
  const semantic = `${input.workspaceId}\u0000${input.changeId}`;
  const digest = createHash('sha256').update(semantic).digest('hex').slice(0, 16);
  const label = `${input.workspaceId}-${input.changeId}`
    .replace(/[^a-zA-Z0-9_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80);
  return `change-${label || 'run'}-${digest}`;
}

export function createChangeRunHostWorkflow(): WorkflowPackage {
  const definition = prepareChangeLifecycleDefinition().snapshot;
  return createWorkflowPackage({
    apiVersion: 'repoctopus/v1alpha1',
    kind: 'Workflow',
    metadata: {
      name: 'change-lifecycle-host',
      version: definition.version,
      description: `Storage envelope for ${definition.id}@${definition.version}`,
    },
    entry: 'lifecycle-owned',
    steps: [
      {
        id: 'lifecycle-owned',
        action: {
          type: 'checkpoint',
          ref: 'change-lifecycle-owned',
          summary: 'Change lifecycle transitions are owned by the lifecycle domain',
        },
        onSuccess: null,
        onFailure: 'lifecycle-owned',
      },
    ],
    guardrails: {
      allowedActionTypes: ['checkpoint'],
      allowedRefs: ['change-lifecycle-owned'],
      confirmationRequiredFor: [],
      maxIterations: 1,
      maxRetriesPerAction: 0,
    },
  });
}
