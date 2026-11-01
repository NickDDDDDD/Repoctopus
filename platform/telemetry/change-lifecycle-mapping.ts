import type { Attributes } from '@opentelemetry/api';

import {
  CHANGE_PHASES,
  CHANGE_RUN_STATUSES,
  type ChangeLifecycleTransitionFact,
} from '../../domains/change-lifecycle/transition.js';
import type { TelemetryBatch } from '../../domains/runtime/types.js';
import type { TrajectoryEvent } from '../../domains/trajectory/types.js';
import { workspaceIntentTraceAttributes } from './workspace-intent-mapping.js';

export type ChangeLifecycleTelemetrySignal = 'phase' | 'status' | 'work' | 'wait';

export interface ChangeLifecycleTelemetryRecord {
  schemaVersion: 1;
  signal: ChangeLifecycleTelemetrySignal;
  eventName: `repoctopus.change.${ChangeLifecycleTelemetrySignal}`;
  eventId: string;
  timestamp: string;
  body: string;
  attributes: Attributes;
}

export interface ChangeLifecycleTelemetryProjection {
  runId: string;
  changeId: string;
  phase: string;
  status: string;
  currentWork: { workId: string; kind: string; taskId?: string; validatorProfile: string } | null;
  wait: { waitId: string; kind: string; reasonCategory: string } | null;
  eventId: string;
  revision: number;
  checkEpoch: number;
  observedAt: string;
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,255}$/u;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/u;

function safeId(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_ID.test(value) ? value : undefined;
}

function transitionFact(event: TrajectoryEvent): ChangeLifecycleTransitionFact | null {
  if (event.type !== 'change.lifecycle.transitioned') return null;
  const value = event.data.changeLifecycleTransition;
  if (!value || value.schemaVersion !== 2) return null;
  if (!safeId(value.transitionId) || !Number.isSafeInteger(value.revision)) return null;
  if (!CHANGE_PHASES.includes(value.from.phase) || !CHANGE_PHASES.includes(value.to.phase)) {
    return null;
  }
  if (
    !CHANGE_RUN_STATUSES.includes(value.from.status) ||
    !CHANGE_RUN_STATUSES.includes(value.to.status)
  ) {
    return null;
  }
  if (
    !Number.isSafeInteger(value.from.checkEpoch) ||
    !Number.isSafeInteger(value.to.checkEpoch) ||
    value.to.checkEpoch !== value.from.checkEpoch + 1
  ) {
    return null;
  }
  return value;
}

function commonAttributes(
  batch: TelemetryBatch,
  event: TrajectoryEvent,
  fact: ChangeLifecycleTransitionFact,
): Attributes {
  const changeId = batch.run.changeLifecycle?.identity.changeId;
  const openRepair = fact.openRepair;
  return {
    'repoctopus.project.id': batch.projectSnapshot.projectId,
    'repoctopus.run.id': batch.run.runId,
    ...(changeId && safeId(changeId) ? { 'repoctopus.change.id': changeId } : {}),
    'repoctopus.event.id': event.eventId,
    'repoctopus.event.sequence': event.sequence,
    'repoctopus.state.version': event.stateVersion,
    'repoctopus.change.transition.id': fact.transitionId,
    'repoctopus.change.transition.revision': fact.revision,
    'repoctopus.change.check_epoch.before': fact.from.checkEpoch,
    'repoctopus.change.check_epoch': fact.to.checkEpoch,
    'repoctopus.change.phase.before': fact.from.phase,
    'repoctopus.change.phase': fact.to.phase,
    'repoctopus.change.status.before': fact.from.status,
    'repoctopus.change.status': fact.to.status,
    ...(openRepair
      ? {
          'repoctopus.open.repair.source': openRepair.source,
          'repoctopus.open.repair.reason_code': openRepair.reasonCode,
          'repoctopus.open.repair.result': 'dispatched',
          'repoctopus.open.repair.execution_retired':
            event.data.executionRetirement !== undefined,
        }
      : {}),
    ...workspaceIntentTraceAttributes(event),
  };
}

export function acceptedChangeLifecycleTelemetry(
  batch: TelemetryBatch,
  event: TrajectoryEvent,
): ChangeLifecycleTelemetryRecord[] {
  const fact = transitionFact(event);
  if (!fact) return [];
  const common = commonAttributes(batch, event, fact);
  const work = fact.work ?? null;
  const wait = fact.wait ?? null;
  const attributesBySignal: Record<ChangeLifecycleTelemetrySignal, Attributes> = {
    phase: {},
    status: {},
    work: {
      'repoctopus.change.work.active': work !== null,
      ...(work && safeId(work.workId) ? { 'repoctopus.change.work.id': work.workId } : {}),
      ...(work && safeId(work.kind) ? { 'repoctopus.change.work.kind': work.kind } : {}),
      ...(work?.taskId && safeId(work.taskId) ? { 'repoctopus.change.task.id': work.taskId } : {}),
      ...(work && safeId(work.validatorProfile.id)
        ? { 'repoctopus.change.validator.id': work.validatorProfile.id }
        : {}),
      ...(work && safeId(work.validatorProfile.version)
        ? { 'repoctopus.change.validator.version': work.validatorProfile.version }
        : {}),
      ...(work && SHA256_DIGEST.test(work.validatorProfile.digest)
        ? { 'repoctopus.change.validator.digest': work.validatorProfile.digest }
        : {}),
    },
    wait: {
      'repoctopus.change.wait.active': wait !== null,
      ...(wait && safeId(wait.waitId) ? { 'repoctopus.change.wait.id': wait.waitId } : {}),
      ...(wait && safeId(wait.kind)
        ? {
            'repoctopus.change.wait.kind': wait.kind,
            'repoctopus.change.wait.reason_category': wait.kind,
          }
        : {}),
    },
  };
  return (Object.keys(attributesBySignal) as ChangeLifecycleTelemetrySignal[]).map((signal) => ({
    schemaVersion: 1,
    signal,
    eventName: `repoctopus.change.${signal}`,
    eventId: event.eventId,
    timestamp: event.timestamp,
    body: `Repoctopus Change lifecycle ${signal} event`,
    attributes: { ...common, ...attributesBySignal[signal] },
  }));
}

export function projectChangeLifecycleTelemetry(
  records: readonly ChangeLifecycleTelemetryRecord[],
): ChangeLifecycleTelemetryProjection | null {
  if (records.length === 0) return null;
  const groups = new Map<string, ChangeLifecycleTelemetryRecord[]>();
  for (const record of records) {
    const runId = safeId(record.attributes['repoctopus.run.id']);
    const changeId = safeId(record.attributes['repoctopus.change.id']);
    if (!runId || !changeId || !safeId(record.eventId)) continue;
    const key = `${runId}\0${changeId}\0${record.eventId}`;
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  const candidates = [...groups.values()]
    .map((group) => {
      const bySignal = new Map(group.map((record) => [record.signal, record]));
      if (bySignal.size !== 4) return null;
      const revisions = new Set(
        group.map((record) => record.attributes['repoctopus.change.transition.revision']),
      );
      const epochs = new Set(
        group.map((record) => record.attributes['repoctopus.change.check_epoch']),
      );
      if (revisions.size !== 1 || epochs.size !== 1) return null;
      const revision = [...revisions][0];
      const checkEpoch = [...epochs][0];
      if (typeof revision !== 'number' || typeof checkEpoch !== 'number') return null;
      return { bySignal, revision, checkEpoch, latest: group.at(-1)! };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort(
      (left, right) =>
        left.checkEpoch - right.checkEpoch ||
        left.revision - right.revision ||
        left.latest.timestamp.localeCompare(right.latest.timestamp) ||
        left.latest.eventId.localeCompare(right.latest.eventId),
    );
  const selected = candidates.at(-1);
  if (!selected) return null;
  const { bySignal, latest, revision, checkEpoch } = selected;
  const phase = bySignal.get('phase')?.attributes;
  const status = bySignal.get('status')?.attributes;
  const work = bySignal.get('work')?.attributes;
  const wait = bySignal.get('wait')?.attributes;
  const runId = safeId(latest.attributes['repoctopus.run.id']);
  const changeId = safeId(latest.attributes['repoctopus.change.id']);
  const phaseValue = safeId(phase?.['repoctopus.change.phase']);
  const statusValue = safeId(status?.['repoctopus.change.status']);
  if (
    !runId ||
    !changeId ||
    !phaseValue ||
    !statusValue ||
    !Number.isSafeInteger(revision) ||
    !Number.isSafeInteger(checkEpoch)
  ) {
    return null;
  }
  const workId = safeId(work?.['repoctopus.change.work.id']);
  const workKind = safeId(work?.['repoctopus.change.work.kind']);
  const validatorProfile = safeId(work?.['repoctopus.change.validator.id']);
  const taskId = safeId(work?.['repoctopus.change.task.id']);
  const waitId = safeId(wait?.['repoctopus.change.wait.id']);
  const waitKind = safeId(wait?.['repoctopus.change.wait.kind']);
  return {
    runId,
    changeId,
    phase: phaseValue,
    status: statusValue,
    currentWork:
      work?.['repoctopus.change.work.active'] === true && workId && workKind && validatorProfile
        ? { workId, kind: workKind, ...(taskId ? { taskId } : {}), validatorProfile }
        : null,
    wait:
      wait?.['repoctopus.change.wait.active'] === true && waitId && waitKind
        ? { waitId, kind: waitKind, reasonCategory: waitKind }
        : null,
    eventId: latest.eventId,
    revision,
    checkEpoch,
    observedAt: latest.timestamp,
  };
}
