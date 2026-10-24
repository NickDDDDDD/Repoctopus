import { Context } from '@deepseek-ai/cordis';
import { afterEach, describe, expect, it } from 'vitest';

import type { ActionAdapter } from '../domains/action/ports.js';
import type { ActionClaimInput, ClaimedActionOutcome } from '../domains/action/types.js';
import type { CompositionIdentitySnapshot } from '../domains/composition/types.js';
import { FileActionStore } from '../platform/action/file-action-store.js';
import { ActionDispatcher, ActionStore } from '../services/action.js';
import { CompositionIdentity } from '../services/composition-identity.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

const composition: CompositionIdentitySnapshot = {
  id: 'action-claims',
  kind: 'project',
  compositionDigest: `sha256:${'c'.repeat(64)}`,
  plugins: [],
};

class TestActionStore extends ActionStore {
  protected readonly port;

  constructor(context: Context, workspace: string) {
    super(context);
    this.port = new FileActionStore(workspace);
  }
}

function claimInput(
  overrides: Partial<Pick<ActionClaimInput, 'workId' | 'attempt' | 'inputDigest'>> = {},
): ActionClaimInput {
  return {
    runId: 'action-claim-run',
    workId: 'build:1.1',
    attempt: 1,
    inputDigest: `sha256:${'a'.repeat(64)}`,
    composition,
    action: {
      id: 'build:1.1',
      stepId: 'build',
      type: 'invoke_skill',
      ref: 'implement-task',
      summary: 'Implement Task 1.1',
    },
    adapter: 'test',
    ...overrides,
  };
}

function outcome(
  intent: Awaited<ReturnType<ActionDispatcher['claim']>>,
  outcomeId = 'outcome-1',
): ClaimedActionOutcome {
  return {
    schemaVersion: 1,
    outcomeId,
    runId: intent.runId,
    workId: intent.workId,
    attempt: intent.attempt,
    claimToken: intent.claimToken,
    inputDigest: intent.inputDigest,
    status: 'succeeded',
    summary: 'done',
  };
}

function harness(workspace: string, executions: { count: number }) {
  const context = new Context();
  new CompositionIdentity(context, composition);
  new TestActionStore(context, workspace);
  const dispatcher = new ActionDispatcher(context);
  const adapter: ActionAdapter = {
    id: 'test',
    complete(intent, input) {
      executions.count += 1;
      return Promise.resolve({
        schemaVersion: 2,
        receiptId: input.receiptId,
        intentId: intent.intentId,
        idempotencyKey: intent.idempotencyKey,
        runId: intent.runId,
        workId: intent.workId,
        attempt: intent.attempt,
        claimToken: intent.claimToken,
        inputDigest: intent.inputDigest,
        outcomeId: input.outcomeId,
        compositionDigest: input.compositionDigest,
        actionId: intent.action.id,
        adapter: 'test',
        outcome: input.status,
        summary: input.summary,
        completedAt: '2026-10-24T00:00:00.000Z',
      });
    },
  };
  dispatcher.register(adapter);
  return { context, dispatcher };
}

describe('Action claims', () => {
  it('fences duplicate, stale, and cross-Work claims and replays a lost response', async () => {
    const workspace = await temporaryDirectory('repoctopus-action-claims-');
    cleanup.push(workspace);
    const executions = { count: 0 };
    const firstProcess = harness(workspace, executions);

    const [first, duplicate] = await Promise.all([
      firstProcess.dispatcher.claim(claimInput()),
      firstProcess.dispatcher.claim(claimInput()),
    ]);
    expect(duplicate).toEqual(first);
    expect(first).toMatchObject({
      schemaVersion: 2,
      runId: 'action-claim-run',
      workId: 'build:1.1',
      attempt: 1,
      inputDigest: `sha256:${'a'.repeat(64)}`,
    });
    expect(first.claimToken).toMatch(/^sha256:[a-f0-9]{64}$/u);
    await expect(
      firstProcess.dispatcher.claim(
        claimInput({ inputDigest: `sha256:${'b'.repeat(64)}` }),
      ),
    ).rejects.toThrow(/identity changed|stale/u);
    await firstProcess.context.fiber.dispose();

    const recoveredProcess = harness(workspace, executions);
    expect(await recoveredProcess.dispatcher.claim(claimInput())).toEqual(first);
    const second = await recoveredProcess.dispatcher.claim(claimInput({ attempt: 2 }));
    await expect(recoveredProcess.dispatcher.complete(outcome(first))).rejects.toThrow(
      /stale attempt/u,
    );

    const other = await recoveredProcess.dispatcher.claim(
      claimInput({ workId: 'build:1.2' }),
    );
    await expect(
      recoveredProcess.dispatcher.complete({
        ...outcome(other, 'cross-work'),
        claimToken: second.claimToken,
      }),
    ).rejects.toThrow(/does not match its claimed Work/u);

    const completed = await recoveredProcess.dispatcher.complete(outcome(second));
    const replayAfterLostResponse = await recoveredProcess.dispatcher.complete(outcome(second));
    expect(replayAfterLostResponse).toEqual(completed);
    expect(completed).toMatchObject({
      schemaVersion: 2,
      runId: second.runId,
      workId: second.workId,
      attempt: second.attempt,
      claimToken: second.claimToken,
      inputDigest: second.inputDigest,
      outcomeId: 'outcome-1',
    });
    expect(executions.count).toBe(1);
    await recoveredProcess.context.fiber.dispose();
  });
});
