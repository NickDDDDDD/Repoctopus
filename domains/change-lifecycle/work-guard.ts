import path from 'node:path';

import type { ActionIntent } from '../action/types.js';
import type { RunState } from '../engine/types.js';
import type { SpecificationArtifactKind } from '../specification/types.js';
import type { WorkDescriptor } from './transition.js';

export interface RuntimeWorkClaimReference {
  runId: string;
  workId: string;
  attempt: number;
  claimToken: `sha256:${string}`;
  inputDigest: `sha256:${string}`;
}

interface RuntimeWorkOperationBase {
  adapterId: string;
  claim?: RuntimeWorkClaimReference;
}

export type RuntimeWorkOperation =
  | (RuntimeWorkOperationBase & {
      kind: 'repository-file';
      repositoryId: string;
      path: string;
      operation: 'create' | 'update' | 'delete';
    })
  | (RuntimeWorkOperationBase & { kind: 'command' })
  | (RuntimeWorkOperationBase & { kind: 'git-publish'; repositoryId: string })
  | (RuntimeWorkOperationBase & { kind: 'merge-request'; repositoryId: string })
  | (RuntimeWorkOperationBase & { kind: 'tracker-publish' })
  | (RuntimeWorkOperationBase & {
      kind: 'specification-write';
      repositoryId: string;
      path: string;
      operation: 'create' | 'update' | 'delete';
      providerId: string;
      artifactKind: SpecificationArtifactKind;
      terminalArtifact: boolean;
    });

export interface RuntimeWorkAuthorization {
  runId: string;
  workId: string;
  attempt: number;
  operation: RuntimeWorkOperation['kind'];
}

export interface RuntimeMutationObservation {
  kind: 'runtime-work-drift';
  status: 'drift';
  success: false;
  repositoryId: string;
  path: string;
  reason: string;
}

export class RuntimeWorkAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeWorkAuthorizationError';
  }
}

const requiredCapabilities: Readonly<Record<RuntimeWorkOperation['kind'], string>> = {
  'repository-file': 'repository.write',
  command: 'process.execute',
  'git-publish': 'git.publish',
  'merge-request': 'platform.mutate',
  'tracker-publish': 'platform.mutate',
  'specification-write': 'specification.write',
};

function reject(message: string): never {
  throw new RuntimeWorkAuthorizationError(message);
}

function normalizedRelativePath(value: string): string {
  const portable = value.replaceAll('\\', '/');
  if (
    !portable ||
    portable.startsWith('/') ||
    /^[A-Za-z]:\//u.test(portable) ||
    portable.split('/').includes('..')
  ) {
    reject(`Runtime Work path must be a safe repository-relative path: ${value}`);
  }
  const normalized = path.posix.normalize(portable).replace(/^\.\//u, '');
  if (!normalized || normalized === '.') reject('Runtime Work path must name an artifact');
  return normalized;
}

function pathMatches(pattern: string, candidate: string): boolean {
  const normalizedPattern = normalizedRelativePath(pattern);
  if (normalizedPattern === '**') return true;
  if (normalizedPattern.endsWith('/**')) {
    const prefix = normalizedPattern.slice(0, -3);
    return candidate === prefix || candidate.startsWith(`${prefix}/`);
  }
  return candidate === normalizedPattern;
}

function assertWriteScope(
  work: WorkDescriptor,
  operation: Extract<RuntimeWorkOperation, { kind: 'repository-file' | 'specification-write' }>,
): void {
  const candidate = normalizedRelativePath(operation.path);
  const allowed = work.writeScopes.some(
    (scope) =>
      scope.repositoryId === operation.repositoryId &&
      scope.operations.includes(operation.operation) &&
      scope.paths.some((pattern) => pathMatches(pattern, candidate)),
  );
  if (!allowed) {
    reject(
      `Runtime Work ${work.workId} does not allow ${operation.operation} in ${operation.repositoryId}:${candidate}`,
    );
  }
}

function assertClaim(intent: ActionIntent, operation: RuntimeWorkOperation): RuntimeWorkClaimReference {
  const claim = operation.claim;
  if (!claim) reject('Runtime write requires an active Action claim');
  const exact =
    claim.runId === intent.runId &&
    claim.workId === intent.workId &&
    claim.attempt === intent.attempt &&
    claim.claimToken === intent.claimToken &&
    claim.inputDigest === intent.inputDigest;
  if (!exact) reject('Runtime write claim does not match the active Action Intent');
  if (operation.adapterId !== intent.adapter) {
    reject(`Runtime write Adapter does not match the active claim: ${operation.adapterId}`);
  }
  return claim;
}

export function authorizeRuntimeWorkOperation(input: {
  state: RunState;
  intent: ActionIntent;
  operation: RuntimeWorkOperation;
}): RuntimeWorkAuthorization {
  const claim = assertClaim(input.intent, input.operation);
  if (input.state.runId !== claim.runId || input.state.status !== 'running') {
    reject(`Runtime Work claim is not attached to a running Run: ${claim.runId}`);
  }
  const work = input.state.changeLifecycle?.currentWork;
  if (!work || work.workId !== claim.workId || work.inputDigest !== claim.inputDigest) {
    reject('Runtime Work claim is not attached to the active Work input');
  }
  const capability = requiredCapabilities[input.operation.kind];
  if (!work.capabilities.includes(capability)) {
    reject(`Runtime Work ${work.workId} lacks capability ${capability}`);
  }

  if (
    input.operation.kind === 'repository-file' ||
    input.operation.kind === 'specification-write'
  ) {
    assertWriteScope(work, input.operation);
  }
  if (input.operation.kind === 'specification-write') {
    if (input.operation.terminalArtifact) {
      reject('Terminal Specification artifacts are immutable');
    }
    const providerId = input.state.specificationUsageSnapshot?.provider.id;
    if (!providerId || providerId !== input.operation.providerId) {
      reject(`Specification Provider does not match the Run snapshot: ${input.operation.providerId}`);
    }
    if (!work.outputContract.artifactKinds.includes(input.operation.artifactKind)) {
      reject(
        `Specification artifact kind is outside the Work output contract: ${input.operation.artifactKind}`,
      );
    }
  }
  if (input.operation.kind === 'tracker-publish' && !work.outputContract.trackerPublish) {
    reject(`Runtime Work ${work.workId} may not publish tracker state`);
  }

  return {
    runId: claim.runId,
    workId: claim.workId,
    attempt: claim.attempt,
    operation: input.operation.kind,
  };
}

export function observeUnmanagedRuntimeMutation(input: {
  repositoryId: string;
  path: string;
  reason?: string;
}): RuntimeMutationObservation {
  return {
    kind: 'runtime-work-drift',
    status: 'drift',
    success: false,
    repositoryId: input.repositoryId,
    path: normalizedRelativePath(input.path),
    reason: input.reason ?? 'Mutation was observed without a matching Runtime Work claim',
  };
}
