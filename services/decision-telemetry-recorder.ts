import { createHash } from 'node:crypto';

import type { RunState } from '../domains/engine/types.js';
import type { RunStorePort, TelemetryPort } from '../domains/runtime/types.js';
import {
  decisionPhase,
  type DecisionKind,
  type DecisionTrajectoryData,
} from '../domains/telemetry/decision-trajectory.js';
import type { TrajectoryEvent } from '../domains/trajectory/types.js';

function eventId(runId: string, type: string, decisionId: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(`${runId}\0${type}\0${decisionId}`).digest('hex')}`;
}

export class DecisionTelemetryRecorder {
  constructor(
    private readonly store: RunStorePort,
    private readonly telemetry: TelemetryPort,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async record(input: {
    runId: string;
    decisionId: string;
    kind: DecisionKind;
    stage: 'requested' | 'resolved';
    outcome?: 'approve' | 'revise' | 'reject';
  }): Promise<void> {
    const outcome = input.outcome;
    if (input.stage === 'resolved' && !outcome) {
      throw new Error('Resolved Human Decision boundary requires an outcome');
    }
    const type = `decision.${input.stage}` as const;
    const data: DecisionTrajectoryData =
      input.stage === 'requested'
        ? {
            schemaVersion: 1,
            phase: decisionPhase(input.kind),
            decisionId: input.decisionId,
            decisionKind: input.kind,
            result: 'requested',
          }
        : {
            schemaVersion: 1,
            phase: decisionPhase(input.kind),
            decisionId: input.decisionId,
            decisionKind: input.kind,
            result: outcome === 'approve' ? 'accepted' : 'rejected',
            outcome: outcome as 'approve' | 'revise' | 'reject',
          };
    await this.store.commitGuarded(input.runId, ({ state, trajectory }) => {
      const stableEventId = eventId(input.runId, type, input.decisionId);
      if (trajectory.some((candidate) => candidate.eventId === stableEventId)) {
        return { value: undefined };
      }
      const timestamp = this.clock().toISOString();
      const nextState: RunState = {
        ...state,
        stateVersion: state.stateVersion + 1,
        updatedAt: timestamp,
      };
      const event: TrajectoryEvent = {
        schemaVersion: 1,
        sequence: trajectory.length + 1,
        eventId: stableEventId,
        timestamp,
        type,
        runId: input.runId,
        stateVersion: nextState.stateVersion,
        compositionDigest: nextState.composition.compositionDigest,
        data,
      };
      return { state: nextState, event, value: undefined };
    });
    await this.flush(input.runId);
  }

  private async flush(runId: string): Promise<void> {
    try {
      const [cursor, run, workflow, projectSnapshot, trajectory] = await Promise.all([
        this.store.readTelemetryCursor(runId),
        this.store.loadRun(runId),
        this.store.loadWorkflow(runId),
        this.store.loadProjectSnapshot(runId),
        this.store.loadTrajectory(runId),
      ]);
      const events = trajectory.filter((candidate) => candidate.sequence > cursor.trajectoryOffset);
      if (events.length === 0) return;
      await this.telemetry.export({ run, workflow, projectSnapshot, events, trajectory });
      const last = events.at(-1);
      if (!last) return;
      await this.store.writeTelemetryCursor({
        schemaVersion: 1,
        runId,
        trajectoryOffset: last.sequence,
        updatedAt: this.clock().toISOString(),
      });
    } catch {
      // The durable Decision event is authoritative. Telemetry retries from the cursor later.
    }
  }
}
