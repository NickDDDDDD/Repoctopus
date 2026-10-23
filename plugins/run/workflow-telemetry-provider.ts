import type { Context } from '@deepseek-ai/cordis';

import type { TelemetryBatch } from '../../domains/runtime/types.js';
import { WorkflowTelemetry } from '../../services/workflow-support.js';
import { mapWorkflowObservationEnvelope } from '../../platform/telemetry/observation-workflow-mapping.js';

export class WorkflowTelemetryProvider extends WorkflowTelemetry {
  static inject = ['observationTelemetry'];

  constructor(context: Context) {
    super(context);
  }

  async export(batch: TelemetryBatch): Promise<void> {
    const envelopes = batch.events.map((event) => mapWorkflowObservationEnvelope(batch, event));
    await this.ctx.observationTelemetry.publish(envelopes);
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
