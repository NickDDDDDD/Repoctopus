import { createHash } from 'node:crypto';

import type { SpecificationApprovalDecision } from '../specification/types.js';
import type { ExecutionIsolation } from './build-protocol.js';

export const HUMAN_DECISION_RESPONSE_MAX_BYTES = 64 * 1024;
export type LifecycleDecisionKind =
  | 'specification-open'
  | 'specification-design'
  | 'workspace-intent-revision'
  | 'build-plan-risk';
export interface HumanDecisionInteraction {
  channel: 'native' | 'conversation';
  authorization: 'user-response' | 'delegated';
  referenceDigest: `sha256:${string}`;
}
export interface LifecycleDecisionProvenance {
  decision: SpecificationApprovalDecision;
  actorId: string;
  source: 'ide' | 'cli';
  isolation?: ExecutionIsolation;
  interaction?: HumanDecisionInteraction;
}
export interface LifecycleHumanDecisionResponse {
  apiVersion: 'repoctopus/v1alpha1';
  kind: 'LifecycleHumanDecisionResponse';
  runId: string;
  phase: 'open' | 'design' | 'build';
  decisionKind: LifecycleDecisionKind;
  requestId: string;
  proposalHash: `sha256:${string}`;
  decision: SpecificationApprovalDecision;
  isolation?: ExecutionIsolation;
  comment?: string;
  interaction: {
    channel: 'native' | 'conversation';
    authorization: 'user-response' | 'delegated';
    reference: string;
  };
}

export const HUMAN_DECISION_HOST_INSTRUCTIONS = [
  'Read the current decision materials and present all allowed choices and conditional inputs.',
  'Use the Host native user-question tool when available; otherwise present conversation options and wait for an actual user reply.',
  'No answer, a preselected option, silence, or a Work Outcome is not approval. Submit only an actual reply or explicit delegation covering this exact proposal.',
  'Fill responseTemplate and submit through run decide --response-file. Actor comes from the local CLI context; the response file is not independent proof of a human click.',
  'If requiresSubmission is true, collect its required inputs even when shared planning authority is already accepted; a shared approval does not select this Run isolation.',
  'If the result is unknown, query the original request before retrying. After acceptance use the returned next argv; do not edit phase or approval files.',
  'Use interactive terminal run decide only when no real user interaction context is available.',
] as const;

function object(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record))
    if (!fields.includes(key)) throw new Error(`${label} has unknown field: ${key}`);
  return record;
}
function text(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error(`${label} must be nonempty and at most ${max} characters`);
  return value;
}

export function requiresDecisionIsolation(kind: LifecycleDecisionKind): boolean {
  return kind === 'specification-open' || kind === 'workspace-intent-revision';
}

export function parseLifecycleHumanDecisionResponse(
  value: unknown,
): LifecycleHumanDecisionResponse {
  const item = object(
    value,
    [
      'apiVersion',
      'kind',
      'runId',
      'phase',
      'decisionKind',
      'requestId',
      'proposalHash',
      'decision',
      'isolation',
      'comment',
      'interaction',
    ],
    'Human Decision response',
  );
  if (item.apiVersion !== 'repoctopus/v1alpha1' || item.kind !== 'LifecycleHumanDecisionResponse')
    throw new Error('Unsupported Human Decision response version or kind');
  const phases = {
    'specification-open': 'open',
    'specification-design': 'design',
    'workspace-intent-revision': 'open',
    'build-plan-risk': 'build',
  } as const;
  if (
    typeof item.decisionKind !== 'string' ||
    !Object.hasOwn(phases, item.decisionKind) ||
    phases[item.decisionKind as LifecycleDecisionKind] !== item.phase
  )
    throw new Error('Human Decision phase and decisionKind do not match');
  if (typeof item.decision !== 'string' || !['approve', 'revise', 'reject'].includes(item.decision))
    throw new Error('Human Decision requires an explicit allowed decision');
  const decisionKind = item.decisionKind as LifecycleDecisionKind;
  if (item.decision === 'approve' && requiresDecisionIsolation(decisionKind)) {
    if (
      typeof item.isolation !== 'string' ||
      !['current', 'branch', 'worktree'].includes(item.isolation)
    )
      throw new Error('This approval requires current, branch, or worktree isolation');
  } else if (Object.hasOwn(item, 'isolation'))
    throw new Error('Isolation is not applicable to this decision');
  const proposalHash = text(item.proposalHash, 71, 'proposalHash');
  if (!/^sha256:[a-f0-9]{64}$/u.test(proposalHash))
    throw new Error('proposalHash must be a SHA-256 digest');
  const interaction = object(
    item.interaction,
    ['channel', 'authorization', 'reference'],
    'Human Decision interaction',
  );
  if (
    typeof interaction.channel !== 'string' ||
    !['native', 'conversation'].includes(interaction.channel) ||
    typeof interaction.authorization !== 'string' ||
    !['user-response', 'delegated'].includes(interaction.authorization)
  )
    throw new Error(
      'Human Decision requires a real user response or explicit delegation through a supported channel',
    );
  text(interaction.reference, 512, 'interaction.reference');
  text(item.runId, 512, 'runId');
  text(item.requestId, 512, 'requestId');
  if (
    item.comment !== undefined &&
    (typeof item.comment !== 'string' || item.comment.length > 4096)
  )
    throw new Error('Human Decision comment must be at most 4096 characters');
  return structuredClone(item) as unknown as LifecycleHumanDecisionResponse;
}

export function decisionInteraction(
  response: LifecycleHumanDecisionResponse,
): HumanDecisionInteraction {
  return {
    channel: response.interaction.channel,
    authorization: response.interaction.authorization,
    referenceDigest: `sha256:${createHash('sha256').update(response.interaction.reference).digest('hex')}`,
  };
}

export function decisionCommands(runId: string, requestId?: string, proposalHash?: string) {
  return {
    read: [
      'repoctopus',
      'run',
      'decision',
      '--run',
      runId,
      ...(requestId && proposalHash
        ? ['--request-id', requestId, '--proposal-hash', proposalHash]
        : []),
      '--json',
    ],
    submit: [
      'repoctopus',
      'run',
      'decide',
      '--run',
      runId,
      '--response-file',
      '<response.json>',
      '--json',
    ],
    next: ['repoctopus', 'run', 'next', '--run', runId, '--json'],
    terminal: ['repoctopus', 'run', 'decide', '--run', runId],
  };
}
