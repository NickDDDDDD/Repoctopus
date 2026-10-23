import type { TelemetryBatch } from '../../domains/runtime/types.js';
import type {
  ObservationEnvelope,
  ObservationSignal,
} from '../../domains/telemetry/observation-envelope.js';
import { mapObservationEnvelope } from '../../domains/telemetry/observation-envelope.js';
import type { TrajectoryEvent } from '../../domains/trajectory/types.js';

function eventStage(batch: TelemetryBatch, event: TrajectoryEvent): string | undefined {
  if (event.type === 'run.started') return batch.workflow.definition.entry;
  const action = event.data.action;
  if (action && typeof action === 'object') {
    const stepId = (action as Record<string, unknown>).stepId;
    if (typeof stepId === 'string') return stepId;
  }
  if (event.type !== 'action.completed' || typeof event.data.actionId !== 'string') {
    return undefined;
  }
  const proposed = batch.trajectory.find((candidate) => {
    if (candidate.type !== 'action.proposed') return false;
    const proposedAction = candidate.data.action;
    return (
      proposedAction !== null &&
      typeof proposedAction === 'object' &&
      (proposedAction as Record<string, unknown>).id === event.data.actionId
    );
  });
  const proposedAction = proposed?.data.action;
  if (!proposedAction || typeof proposedAction !== 'object') return undefined;
  const stepId = (proposedAction as Record<string, unknown>).stepId;
  return typeof stepId === 'string' ? stepId : undefined;
}

export function mapWorkflowObservationEnvelope(
  batch: TelemetryBatch,
  event: TrajectoryEvent,
): ObservationEnvelope | null {
  const changeId = batch.run.changeId;
  if (!changeId) return null;
  const stageName = eventStage(batch, event);
  const initial = event.type === 'run.started';
  const attributes = {
    'repoctopus.workspace.id': batch.projectSnapshot.projectId,
    'repoctopus.change.id': changeId,
    'repoctopus.run.id': batch.run.runId,
    'repoctopus.workflow.name': batch.run.workflowName,
    'repoctopus.workflow.version': batch.run.workflowVersion,
    'repoctopus.workflow.digest': batch.run.workflowDigest,
    'repoctopus.composition.digest': event.compositionDigest,
    'repoctopus.state.version': event.stateVersion,
    'repoctopus.repository.count': batch.projectSnapshot.repositories.length,
    ...(initial
      ? { 'repoctopus.change.status': 'active', 'repoctopus.run.status': 'active' }
      : {}),
    ...(stageName ? { 'repoctopus.stage.name': stageName } : {}),
  };
  const signals: ObservationSignal[] = [
    {
      kind: 'log',
      name: 'repoctopus.workflow.event',
      severity: event.type === 'recovery.reconciled' ? 'error' : 'info',
    },
    { kind: 'metric', name: 'repoctopus.workflow.events', value: 1, unit: 'event' },
  ];
  if (event.type === 'run.started') signals.unshift({ kind: 'trace', name: 'repoctopus.run' });
  if (event.type === 'action.completed') {
    signals.unshift({ kind: 'trace', name: 'repoctopus.step' });
  }
  return mapObservationEnvelope(
    {
      source: {
        domain: 'workflow',
        eventId: event.eventId,
        eventType: event.type,
        sequence: event.sequence,
      },
      observedAt: event.timestamp,
      attributes,
    },
    { allowedAttributes: Object.keys(attributes), signals },
  );
}

export function observationTransportAttributes(
  envelope: ObservationEnvelope,
): Record<string, string | number | boolean> {
  return {
    ...envelope.attributes,
    'repoctopus.telemetry.schema.version': envelope.schemaVersion,
    'repoctopus.envelope.id': envelope.envelopeId,
    'repoctopus.envelope.digest': envelope.digest,
    'repoctopus.stream.id': String(envelope.attributes['repoctopus.run.id']),
    'repoctopus.event.id': envelope.source.eventId,
    'repoctopus.event.type': envelope.source.eventType,
    'repoctopus.event.sequence': envelope.source.sequence ?? 0,
    'repoctopus.observed_at': envelope.observedAt,
  };
}
