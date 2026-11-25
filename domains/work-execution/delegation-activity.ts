export const DELEGATION_ACTIVITY_EVENT = 'delegation.activity' as const;

export const DELEGATION_STAGES = ['started', 'verifying', 'returned'] as const;
export type DelegationStage = (typeof DELEGATION_STAGES)[number];
export type DelegationRole = 'implementer' | 'reviewer';
export type DelegationResult = 'succeeded' | 'failed' | 'unknown';

export interface DelegationActivity {
  executionId: string;
  role: DelegationRole;
  stage: DelegationStage;
  taskId?: string;
  repositoryId?: string;
}

export function isDelegationStage(value: unknown): value is DelegationStage {
  return DELEGATION_STAGES.includes(value as DelegationStage);
}

export function isDelegationRole(value: unknown): value is DelegationRole {
  return value === 'implementer' || value === 'reviewer';
}

export function isDelegationResult(value: unknown): value is DelegationResult {
  return value === 'succeeded' || value === 'failed' || value === 'unknown';
}

export function isDelegationIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,127}$/u.test(value);
}

export function parseDelegationActivity(input: unknown): DelegationActivity {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Expected a bounded child Agent activity');
  }
  const { executionId, role, stage, taskId, repositoryId, ...extra } = input as Record<
    string,
    unknown
  >;
  if (
    Object.keys(extra).length > 0 ||
    !isDelegationIdentifier(executionId) ||
    !isDelegationRole(role) ||
    !isDelegationStage(stage) ||
    (taskId !== undefined && !isDelegationIdentifier(taskId)) ||
    (repositoryId !== undefined && !isDelegationIdentifier(repositoryId))
  ) {
    throw new Error('Invalid child Agent activity fields');
  }
  return {
    executionId,
    role,
    stage,
    ...(taskId !== undefined ? { taskId } : {}),
    ...(repositoryId !== undefined ? { repositoryId } : {}),
  };
}
