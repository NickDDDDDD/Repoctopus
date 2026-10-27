import type { ChangePhase, WaitCondition } from '../change-lifecycle/transition.js';

export type DecisionKind =
  | 'open-approval'
  | 'design-approval'
  | 'adopt-existing'
  | 'design-revision';

export type ObservationWaitKind = 'human' | 'retry' | 'external-fact' | 'manual-handoff';

export type DecisionTrajectoryData =
  | (Record<string, unknown> & {
      schemaVersion: 1;
      phase: ChangePhase;
      decisionId: string;
      decisionKind: DecisionKind;
      result: 'requested';
    })
  | (Record<string, unknown> & {
      schemaVersion: 1;
      phase: ChangePhase;
      decisionId: string;
      decisionKind: DecisionKind;
      result: 'accepted' | 'rejected';
      outcome: 'approve' | 'revise' | 'reject';
    });

export function decisionKindForWaitId(waitId: string): DecisionKind | null {
  if (waitId.startsWith('open-approval:')) return 'open-approval';
  if (waitId.startsWith('design-approval:')) return 'design-approval';
  if (waitId.startsWith('build-adoption:')) return 'adopt-existing';
  if (waitId.startsWith('build-design:')) return 'design-revision';
  return null;
}

export function observationWaitKind(kind: WaitCondition['kind']): ObservationWaitKind {
  if (kind === 'human-decision') return 'human';
  return kind;
}

export function decisionPhase(kind: DecisionKind): ChangePhase {
  if (kind === 'open-approval') return 'open';
  if (kind === 'design-approval') return 'design';
  return 'build';
}
