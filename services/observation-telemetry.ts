import { createHash } from 'node:crypto';
import { PRODUCT_VERSION } from '../platform/product/version.js';

import type { DeliveryEvent, DeliveryTelemetryPort } from '../domains/delivery/ports.js';
import type { DeliveryState } from '../domains/delivery/types.js';
import type {
  EvidenceTelemetryBatch,
  EvidenceTelemetryPort,
} from '../domains/evidence/telemetry.js';
import type { TelemetryBatch, TelemetryPort } from '../domains/runtime/types.js';
import {
  createApplicationObservationEnvelope,
  createDeliveryObservationEnvelope,
  createEvidenceObservationEnvelopes,
  createWorkflowObservationEnvelopes,
  type ObservationContext,
  type ObservationEnvelope,
} from '../domains/trajectory/observation.js';
import type { ObservationDelivery, ObservationDestination } from './observation-delivery.js';
import type { LifecycleTelemetryEvent, LifecycleTelemetryPort } from './lifecycle-diagnostics.js';
import {
  createRepoctopusResource,
  resolveOtlpDeployment,
} from '../platform/telemetry/opentelemetry/config.js';

/** Transport-only destination configuration. Domain mapping is complete before this boundary. */
export function observationDestinationsFromEnvironment(
  environment: NodeJS.ProcessEnv,
  workspaceEndpoint?: string,
): readonly ObservationDestination[] {
  const destinations: ObservationDestination[] = [];
  const deployment = resolveOtlpDeployment(environment, workspaceEndpoint);
  const signalEndpoints = {
    ...(deployment.traces.url ? { trace: deployment.traces.url } : {}),
    ...(deployment.logs.url ? { log: deployment.logs.url } : {}),
    ...(deployment.metrics.url ? { metric: deployment.metrics.url } : {}),
  };
  if (deployment.enabled) {
    const resource = createRepoctopusResource('repoctopus-runtime', PRODUCT_VERSION, environment);
    const diagnosticMode = environment.REPOCTOPUS_OTLP_DIAGNOSTICS === 'full';
    const explicitSignals = {
      trace: environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim(),
      log: environment.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT?.trim(),
      metric: environment.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT?.trim(),
    };
    destinations.push({
      id: 'remote',
      signalEndpoints: diagnosticMode
        ? signalEndpoints
        : {
            ...(signalEndpoints.log ? { log: signalEndpoints.log } : {}),
            ...(explicitSignals.trace ? { trace: explicitSignals.trace } : {}),
            ...(explicitSignals.metric ? { metric: explicitSignals.metric } : {}),
          },
      ...(!diagnosticMode
        ? {
            select: (envelope, signal) =>
              Boolean(explicitSignals[signal]) || workflowHealthLog(envelope),
          }
        : {}),
      signalHeaders: {
        trace: deployment.traces.headers,
        log: deployment.logs.headers,
        metric: deployment.metrics.headers,
      },
      signalTimeouts: {
        trace: deployment.traces.timeoutMillis,
        log: deployment.logs.timeoutMillis,
        metric: deployment.metrics.timeoutMillis,
      },
      timeoutMillis: deployment.traces.timeoutMillis,
      resourceAttributes: resource.attributes as Readonly<
        Record<string, string | number | boolean>
      >,
    });
  }
  const desktop = environment.REPOCTOPUS_DESKTOP_OTLP_ENDPOINT?.trim();
  if (desktop) {
    const token = environment.REPOCTOPUS_DESKTOP_OTLP_TOKEN?.trim();
    destinations.push({
      id: 'desktop',
      endpoint: desktop,
      timeoutMillis: 5_000,
      resourceAttributes: createRepoctopusResource(
        'repoctopus-runtime',
        PRODUCT_VERSION,
        environment,
      ).attributes as Readonly<Record<string, string | number | boolean>>,
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
    });
  }
  return destinations;
}

const IMPORTANT_DIAGNOSTICS = new Set([
  'work.outcome-processing-error',
  'skill-composition.rejected',
  'work.claim-capability-rejected',
]);

function workflowHealthLog(envelope: ObservationEnvelope): boolean {
  const { eventType, attributes } = envelope;
  return (
    attributes.healthFact === 'state' ||
    attributes.healthFact === 'configuration' ||
    eventType === 'run.started' ||
    (eventType === 'change.lifecycle.transitioned' &&
      attributes.healthFact === undefined &&
      (attributes.fromPhase !== envelope.correlation.phase ||
        attributes.fromStatus !== attributes.toStatus ||
        attributes.workflowRunResult === 'completed' ||
        attributes.workflowRunResult === 'failed')) ||
    attributes.workflowRunResult === 'failed' ||
    IMPORTANT_DIAGNOSTICS.has(eventType) ||
    (eventType.startsWith('application.') && attributes.result === 'failed')
  );
}

abstract class CanonicalObservationTelemetry {
  constructor(
    protected readonly delivery: ObservationDelivery,
    protected readonly environment: NodeJS.ProcessEnv,
  ) {}

  protected async deliver(): Promise<void> {
    const destinations = observationDestinationsFromEnvironment(
      this.environment,
      this.delivery.workspaceOtlpEndpoint,
    );
    const configured = new Set(destinations.map((destination) => destination.id));
    const desktopMode = this.environment.REPOCTOPUS_DESKTOP_OTLP_MODE?.trim();
    await Promise.all([
      this.delivery.setMode('remote', configured.has('remote') ? 'enabled' : 'removed'),
      this.delivery.setMode(
        'desktop',
        desktopMode === 'paused'
          ? 'paused'
          : desktopMode === 'removed' || !configured.has('desktop')
            ? 'removed'
            : 'enabled',
      ),
    ]);
    await this.delivery.deliver(destinations);
  }
}

/** Workflow adapter: persisted Trajectory facts become canonical envelopes exactly once. */
export class WorkflowObservationTelemetry
  extends CanonicalObservationTelemetry
  implements TelemetryPort
{
  async export(batch: TelemetryBatch): Promise<void> {
    const context: ObservationContext = {
      workspaceId: batch.projectSnapshot.projectId,
      ...(batch.run.changeLifecycle?.identity.changeId
        ? { changeId: batch.run.changeLifecycle.identity.changeId }
        : {}),
      workflowName: batch.run.workflowName,
      workflowVersion: batch.run.workflowVersion,
    };
    await this.delivery.append(
      createWorkflowObservationEnvelopes(batch.events, batch.trajectory, context),
    );
    await this.deliver();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

/** Evidence adapter: receipts, Artifacts and Gates use the same outbox and destinations. */
export class EvidenceObservationTelemetry
  extends CanonicalObservationTelemetry
  implements EvidenceTelemetryPort
{
  async export(batch: EvidenceTelemetryBatch): Promise<void> {
    await this.delivery.append(createEvidenceObservationEnvelopes(batch));
    await this.deliver();
  }
}

/** Lightweight delivery/archive adapter without webhook or remote-merge waiting semantics. */
export class DeliveryObservationTelemetry
  extends CanonicalObservationTelemetry
  implements DeliveryTelemetryPort
{
  async export(state: DeliveryState, event: DeliveryEvent): Promise<void> {
    await this.delivery.append([
      createDeliveryObservationEnvelope(event, { changeId: state.changeId }, state),
    ]);
    await this.deliver();
  }
}

/** App/plugin/platform lifecycle adapter used after the project observation service is active. */
export class LifecycleObservationTelemetry
  extends CanonicalObservationTelemetry
  implements LifecycleTelemetryPort
{
  async export(events: readonly LifecycleTelemetryEvent[]): Promise<void> {
    await this.delivery.append(
      events.map((event) =>
        createApplicationObservationEnvelope({
          eventId: createHash('sha256')
            .update(
              `${event.bootId}\0${event.type}\0${event.phase}\0${event.result}\0${event.timestamp}`,
            )
            .digest('hex'),
          runId: `app:${event.bootId}`,
          observedAt: event.timestamp,
          eventType: `application.${event.type}`,
          attributes: {
            platform: process.platform,
            lifecycle: event.phase,
            result: event.result,
          },
        }),
      ),
    );
    await this.deliver();
  }
}
