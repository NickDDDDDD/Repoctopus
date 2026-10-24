import { Service, type Context } from '@deepseek-ai/cordis';

import {
  planChangeLifecycleMigration,
  type LegacyLifecycleRecord,
} from '../domains/change-lifecycle/migration.js';
import { applyChangeLifecycleMigration } from '../domains/change-lifecycle/migration-transaction.js';
import { FileChangeLifecycleMigrationStore } from '../platform/runtime/file-change-lifecycle-migration-store.js';
import type { StartChangeRunInput } from './workflow-runs.js';

export interface ApplyChangeLifecycleMigrationInput {
  legacy: LegacyLifecycleRecord;
  start: StartChangeRunInput;
  auditReferences: readonly string[];
}

export class ChangeLifecycleMigration extends Service {
  static inject = ['workflowRuns'];
  private readonly store: FileChangeLifecycleMigrationStore;

  constructor(context: Context, config: { workspaceRoot: string }) {
    super(context, 'changeLifecycleMigration');
    this.store = new FileChangeLifecycleMigrationStore(config.workspaceRoot);
  }

  plan(legacy: LegacyLifecycleRecord) {
    return planChangeLifecycleMigration(legacy);
  }

  async apply(input: ApplyChangeLifecycleMigrationInput, signal?: AbortSignal) {
    const plan = this.plan(input.legacy);
    if (
      input.legacy.identity.changeId &&
      input.legacy.identity.changeId !== input.start.changeId
    ) {
      throw new Error('Migration target Change does not match the legacy identity');
    }
    const receipt = await applyChangeLifecycleMigration({
      request: {
        schemaVersion: 1,
        plan,
        target: {
          workspaceId: input.start.workspaceId,
          changeId: input.start.changeId,
          generation: input.start.generation,
        },
        auditReferences: input.auditReferences,
      },
      store: this.store,
      startOrResumeTargetRun: async (intent) => {
        const started = await this.ctx.workflowRuns.startChange(input.start, signal);
        if (started.value.state.runId !== intent.targetRunId) {
          throw new Error('WorkflowRuns returned a different migration target Run');
        }
        return { runId: started.value.state.runId };
      },
    });
    return {
      plan,
      receipt,
      run: await this.ctx.workflowRuns.status(receipt.targetRunId, signal),
    };
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    changeLifecycleMigration: ChangeLifecycleMigration;
  }
}
