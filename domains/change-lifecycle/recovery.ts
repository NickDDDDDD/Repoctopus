import {
  assertRecoveryDecision,
  type RecoveryDecision,
} from '../runtime/recovery.js';
import { advanceBuildProtocol, type BuildInvalidation } from './build-protocol.js';
import {
  applyChangeLifecycleTransition,
  evolveChangeLifecycle,
  type ChangeLifecycleDefinition,
  type ChangeLifecycleReduction,
  type ChangeLifecycleSnapshot,
  type ChangeLifecycleTransitionFact,
  type WorkDescriptor,
} from './transition.js';

export interface LifecycleRecoveryMaterialization {
  work: WorkDescriptor;
  inputDigest?: `sha256:${string}`;
  evidenceIds: readonly string[];
  invalidation?: BuildInvalidation;
}

function assertDecisionCheckpoint(
  current: ChangeLifecycleSnapshot,
  decision: RecoveryDecision,
): void {
  assertRecoveryDecision(decision);
  if (
    decision.runId !== current.identity.runId ||
    decision.expectedRevision !== current.revision ||
    decision.checkEpoch !== current.checkEpoch
  ) {
    throw new Error('Recovery decision belongs to a stale lifecycle checkpoint');
  }
}

function attachRecovery(
  reduction: { snapshot: ChangeLifecycleSnapshot; fact: ChangeLifecycleTransitionFact },
  decision: RecoveryDecision,
): ChangeLifecycleReduction {
  return {
    snapshot: reduction.snapshot,
    fact: {
      ...reduction.fact,
      recovery: {
        decisionId: decision.decisionId,
        observationId: decision.observationId,
        action: decision.action,
        authority: decision.authority,
        reasonCode: decision.reasonCode,
        retainedIdentities: [...decision.retainedIdentities],
        invalidatedIdentities: [...decision.invalidatedIdentities],
      },
    },
  };
}

function reviseDesign(input: {
  definition: ChangeLifecycleDefinition;
  current: ChangeLifecycleSnapshot;
  decision: RecoveryDecision;
  materialization: LifecycleRecoveryMaterialization;
}): ChangeLifecycleReduction {
  const { current, decision, materialization } = input;
  if (decision.authority !== 'planning') {
    throw new Error('revise-design requires a planning recovery decision');
  }
  if (!materialization.inputDigest || materialization.work.inputDigest !== materialization.inputDigest) {
    throw new Error('revise-design requires the observed planning input digest');
  }
  const invalidationKind = decision.changedIdentities.includes('approval-authority')
    ? 'approval-authority'
    : 'semantic';
  const reduction = evolveChangeLifecycle({
    definition: input.definition,
    current,
    observation: {
      kind: 'planning-authority-invalidated',
      expectedRevision: decision.expectedRevision,
      fromPhase: current.phase as 'build' | 'verify' | 'archive',
      invalidationKind,
      reason: decision.reasonCode,
      evidenceIds: [...materialization.evidenceIds],
      inputDigest: materialization.inputDigest,
      work: materialization.work,
    },
  });
  if (!reduction.fact) throw new Error('revise-design did not materialize a lifecycle transition');
  return attachRecovery({ snapshot: reduction.snapshot, fact: reduction.fact }, decision);
}

function revisePlan(input: {
  definition: ChangeLifecycleDefinition;
  current: ChangeLifecycleSnapshot;
  decision: RecoveryDecision;
  materialization: LifecycleRecoveryMaterialization;
}): ChangeLifecycleReduction {
  const { current, decision, materialization } = input;
  if (decision.authority !== 'plan') {
    throw new Error('revise-plan requires a Plan recovery decision');
  }
  if (
    current.phase !== 'build' ||
    current.status !== 'running' ||
    !current.buildProtocol ||
    !materialization.invalidation ||
    materialization.work.phase !== 'build' ||
    materialization.work.kind !== 'build.plan' ||
    materialization.work.checkEpoch !== current.checkEpoch + 1
  ) {
    throw new Error('revise-plan does not match the active Build checkpoint');
  }
  const buildProtocol = advanceBuildProtocol(current.buildProtocol, {
    kind: 'revision-required',
    invalidation: materialization.invalidation,
  });
  return attachRecovery(
    applyChangeLifecycleTransition({
      definition: input.definition,
      current,
      transitionId: 'build.check-rejected',
      next: {
        currentWork: materialization.work,
        waitCondition: null,
        blocker: null,
        buildProtocol,
        verificationInput: null,
        verificationInvalidation: null,
        archiveDeliveryInput: null,
        specificationClosure: null,
        publicationReceipt: null,
      },
    }),
    decision,
  );
}

export function applyLifecycleRecoveryDecision(input: {
  definition: ChangeLifecycleDefinition;
  current: ChangeLifecycleSnapshot;
  decision: RecoveryDecision;
  materialization: LifecycleRecoveryMaterialization;
}): ChangeLifecycleReduction {
  assertDecisionCheckpoint(input.current, input.decision);
  if (input.decision.action === 'revise-design') return reviseDesign(input);
  if (input.decision.action === 'revise-plan') return revisePlan(input);
  throw new Error(`Lifecycle recovery action is not materialized: ${input.decision.action}`);
}
