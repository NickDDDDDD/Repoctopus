import type { DesktopShellState } from '../../shared/renderer-contract.js';

export interface DashboardSelection {
  workspaceId: string;
  changeId: string;
}

export interface DashboardChangeChoice extends DashboardSelection {
  runId: string | null;
  status: 'active' | 'completed' | 'failed' | 'pending';
  selected: boolean;
}

export interface DashboardWorkspaceGroup {
  workspaceId: string;
  changes: readonly DashboardChangeChoice[];
}

export interface DashboardNavigationModel {
  groups: readonly DashboardWorkspaceGroup[];
}

function sameSelection(left: DashboardSelection | null, right: DashboardSelection): boolean {
  return left?.workspaceId === right.workspaceId && left.changeId === right.changeId;
}

/**
 * Establishes focus exactly once. A later projection may change its active
 * observation hint, but it cannot overwrite an existing user or launch choice.
 */
export function reconcileDashboardSelection(
  current: DashboardSelection | null,
  shell: DesktopShellState,
): DashboardSelection | null {
  if (current !== null || shell.phase !== 'ready') return current;
  if (shell.launchContext !== null) {
    return {
      workspaceId: shell.launchContext.workspaceId,
      changeId: shell.launchContext.changeId,
    };
  }
  return shell.projection.activeChange ? { ...shell.projection.activeChange } : null;
}

export function dashboardNavigationFromShell(
  shell: DesktopShellState,
  selection: DashboardSelection | null,
): DashboardNavigationModel {
  if (shell.phase !== 'ready') return { groups: [] };

  const choices = shell.projection.changes.map<DashboardChangeChoice>((change) => ({
    workspaceId: change.workspaceId,
    changeId: change.changeId,
    runId: change.currentRunId || null,
    status: change.status,
    selected: sameSelection(selection, change),
  }));
  if (selection !== null && !choices.some((choice) => sameSelection(selection, choice))) {
    choices.push({
      ...selection,
      runId:
        shell.launchContext?.workspaceId === selection.workspaceId &&
        shell.launchContext.changeId === selection.changeId
          ? shell.launchContext.runId
          : null,
      status: 'pending',
      selected: true,
    });
  }

  const workspaces = new Map<string, DashboardChangeChoice[]>();
  for (const choice of choices) {
    const existing = workspaces.get(choice.workspaceId) ?? [];
    existing.push(choice);
    workspaces.set(choice.workspaceId, existing);
  }
  return {
    groups: [...workspaces.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([workspaceId, changes]) => ({
        workspaceId,
        changes: changes.sort((left, right) => left.changeId.localeCompare(right.changeId)),
      })),
  };
}
