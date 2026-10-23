import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  assertSpecificationApprovalState,
  type SpecificationApprovalStorePort,
} from '../../domains/specification/planning-approval.js';
import type { SpecificationApprovalState } from '../../domains/specification/types.js';
import { atomicWriteJson } from '../filesystem/atomic-write.js';
import { RecoverableFileTransition } from '../runtime/recoverable-file-transition.js';

interface PlanningApprovalJournal {
  schemaVersion: 1;
  previousStateVersion: number | null;
  nextState: SpecificationApprovalState;
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function assertChangeId(changeId: string): void {
  if (!/^[a-z0-9][a-z0-9-]{2,127}$/u.test(changeId)) {
    throw new Error(`Invalid specification change id: ${changeId}`);
  }
}

function planningApprovalState(value: unknown): SpecificationApprovalState {
  const state = value as SpecificationApprovalState | null;
  if (
    !state ||
    state.schemaVersion !== 1 ||
    !Number.isSafeInteger(state.stateVersion) ||
    state.stateVersion < 0 ||
    state.changeId !== state.snapshot?.changeId ||
    state.decisionRequest?.changeId !== state.changeId ||
    state.decisionRequest?.snapshotDigest !== state.snapshot?.digest ||
    (state.decision !== null && state.decision.snapshotDigest !== state.snapshot?.digest)
  ) {
    throw new Error('Invalid specification approval state');
  }
  assertSpecificationApprovalState(state, { allowLegacy: true });
  return state;
}

export class FilePlanningApprovalStore implements SpecificationApprovalStorePort {
  constructor(private readonly workspaceRoot: string) {}

  private paths(changeId: string) {
    assertChangeId(changeId);
    const root = path.join(
      path.resolve(this.workspaceRoot),
      '.repoctopus',
      'specification-approvals',
      changeId,
    );
    return {
      state: path.join(root, 'state.json'),
      journal: path.join(root, 'transition.json'),
      lock: path.join(root, 'transition.lock'),
    };
  }

  async load(changeId: string): Promise<SpecificationApprovalState | null> {
    const paths = this.paths(changeId);
    await this.transition(paths).recover((journal) => this.replay(paths, journal));
    if (!(await exists(paths.state))) return null;
    return planningApprovalState(JSON.parse(await readFile(paths.state, 'utf8')) as unknown);
  }

  async commit(
    state: SpecificationApprovalState,
    previousStateVersion: number | null,
  ): Promise<void> {
    planningApprovalState(state);
    const paths = this.paths(state.changeId);
    await this.transition(paths).run(
      (journal) => this.replay(paths, journal),
      async (transition) => {
        const current = (await exists(paths.state))
          ? planningApprovalState(JSON.parse(await readFile(paths.state, 'utf8')) as unknown)
          : null;
        if (previousStateVersion === null) {
          if (current) throw new Error(`Specification approval already exists: ${state.changeId}`);
        } else if (!current || current.stateVersion !== previousStateVersion) {
          throw new Error(`Stale specification approval state: ${state.changeId}`);
        }
        await transition.commit(
          { schemaVersion: 1, previousStateVersion, nextState: state },
          (journal) => this.replay(paths, journal),
        );
      },
    );
  }

  private async replay(
    paths: ReturnType<FilePlanningApprovalStore['paths']>,
    journal: PlanningApprovalJournal,
  ): Promise<void> {
    if (journal.schemaVersion !== 1) throw new Error('Invalid specification approval journal');
    planningApprovalState(journal.nextState);
    await atomicWriteJson(paths.state, journal.nextState);
  }

  private transition(
    paths: ReturnType<FilePlanningApprovalStore['paths']>,
  ): RecoverableFileTransition<PlanningApprovalJournal> {
    return new RecoverableFileTransition(paths.lock, paths.journal);
  }
}
