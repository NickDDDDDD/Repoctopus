import type { RunStatusView } from '../../domains/runtime/types.js';

type ChangeRunProjection = NonNullable<RunStatusView['changeLifecycle']>;

export function changeProjection(value: unknown): ChangeRunProjection | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { changeLifecycle?: unknown };
  if (!candidate.changeLifecycle || typeof candidate.changeLifecycle !== 'object') return null;
  return candidate.changeLifecycle as ChangeRunProjection;
}

export function renderChangeProjection(projection: ChangeRunProjection): string[] {
  const lines = [
    `Change: ${projection.identity.changeId} (generation ${projection.identity.generation})`,
    `Phase: ${projection.phase}`,
    `Status: ${projection.status}`,
    `Work: ${projection.currentWork ? `${projection.currentWork.kind} [${projection.currentWork.workId}]` : '-'}`,
    `Tasks: ${projection.taskProgress.completed}/${projection.taskProgress.total}${projection.taskProgress.currentTaskId ? ` (current ${projection.taskProgress.currentTaskId})` : ''}`,
    `Evidence: ${projection.evidence.gateStatus} (${projection.evidence.acceptedBundleIds.length} accepted)`,
  ];
  if (projection.waitCondition) {
    lines.push(`Wait: ${projection.waitCondition.kind} - ${projection.waitCondition.reason}`);
  }
  if (projection.blocker) {
    lines.push(`Blocker: ${projection.blocker.code} - ${projection.blocker.message}`);
  }
  if (projection.nextActions.length > 0) {
    lines.push(
      'Lifecycle next actions:',
      ...projection.nextActions.map((action) => `- ${action.label} [${action.id}]`),
    );
  }
  return lines;
}
