import type { ProjectedChange, ProjectedDelegation } from './projection.js';
import type { ObservationEnvelope } from './observation.js';

export const WORK_ACTIVITY_FRESHNESS_MS = 15 * 60 * 1_000;

export function activeDelegations(change: ProjectedChange, now: number): ProjectedDelegation[] {
  const work = change.currentWork;
  if (
    change.phase !== 'build' ||
    change.lifecycle?.status !== 'running' ||
    change.buildAction !== 'execute' ||
    (change.displayState !== 'live' && change.displayState !== 'rework') ||
    !work?.activeInvocationId ||
    work.state !== 'running'
  ) {
    return [];
  }
  return (change.delegations ?? []).filter(
    (item) =>
      item.workId === work.workId &&
      item.attempt === work.attempt &&
      item.invocationId === work.activeInvocationId &&
      item.stage !== 'returned' &&
      now < Date.parse(item.observedAt) + WORK_ACTIVITY_FRESHNESS_MS,
  );
}

export function changeKey({
  workspaceId,
  changeId,
  runId,
}: Pick<ProjectedChange, 'workspaceId' | 'changeId' | 'runId'>): string {
  return `${workspaceId}\0${changeId}\0${runId}`;
}

export function observationReceptionKey(envelope: ObservationEnvelope): string {
  const { workspaceId, changeId } = envelope.correlation;
  if (!workspaceId || !changeId) return envelope.envelopeId;
  return `${changeKey({ workspaceId, changeId, runId: envelope.identity.runId })}\0${envelope.envelopeId}`;
}
