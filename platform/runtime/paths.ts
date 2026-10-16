import path from 'node:path';

export interface RunPaths {
  root: string;
  run: string;
  workflow: string;
  projectSnapshot: string;
  trajectory: string;
  checkpoint: string;
  transitionJournal: string;
  transitionLock: string;
  telemetryCursor: string;
}

export function assertRunId(runId: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{5,127}$/.test(runId)) {
    throw new Error(`Invalid run id: ${runId}`);
  }
}

export function runPaths(workspaceRoot: string, runId: string): RunPaths {
  assertRunId(runId);
  const root = path.join(path.resolve(workspaceRoot), '.repoctopus', 'runs', runId);
  return {
    root,
    run: path.join(root, 'run.json'),
    workflow: path.join(root, 'workflow.json'),
    projectSnapshot: path.join(root, 'project-snapshot.json'),
    trajectory: path.join(root, 'trajectory.jsonl'),
    checkpoint: path.join(root, 'checkpoint.json'),
    transitionJournal: path.join(root, 'transition.json'),
    transitionLock: path.join(root, 'transition.lock'),
    telemetryCursor: path.join(root, 'telemetry-cursor.json'),
  };
}
