import { createHash } from 'node:crypto';

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
  createObservationEnvelope,
  type ObservationContext,
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
): readonly ObservationDestination[] {
  const destinations: ObservationDestination[] = [];
  const deployment = resolveOtlpDeployment(environment);
  const remote = environment.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  const signalEndpoints = {
    ...(deployment.traces.url ? { trace: deployment.traces.url } : {}),
    ...(deployment.logs.url ? { log: deployment.logs.url } : {}),
    ...(deployment.metrics.url ? { metric: deployment.metrics.url } : {}),
  };
  if (deployment.enabled) {
    const resource = createRepoctopusResource('repoctopus-runtime', '0.1.0', environment);
    destinations.push({
      id: 'remote',
      ...(remote ? { endpoint: remote } : {}),
      ...(Object.keys(signalEndpoints).length > 0 ? { signalEndpoints } : {}),
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
      resourceAttributes: createRepoctopusResource('repoctopus-runtime', '0.1.0', environment)
        .attributes as Readonly<Record<string, string | number | boolean>>,
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
    });
  }
  return destinations;
}

abstract class CanonicalObservationTelemetry {
  constructor(
    protected readonly delivery: ObservationDelivery,
    protected readonly environment: NodeJS.ProcessEnv,
  ) {}

  protected async deliver(): Promise<void> {
    const destinations = observationDestinationsFromEnvironment(this.environment);
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
    await this.delivery.replayAll(destinations);
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
      batch.events.map((event) => createObservationEnvelope(event, context)),
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
      createDeliveryObservationEnvelope(event, { changeId: state.changeId }),
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
