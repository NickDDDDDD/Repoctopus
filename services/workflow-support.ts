import { Service, type Context } from '@deepseek-ai/cordis';

import type {
  TelemetryBatch,
  TelemetryPort,
  WorkflowSourcePort,
} from '../domains/runtime/types.js';
import type { WorkflowPackage } from '../domains/workflow-contract/types.js';

export abstract class WorkflowTelemetry extends Service implements TelemetryPort {
  constructor(context: Context) {
    super(context, 'workflowTelemetry');
  }

  abstract export(batch: TelemetryBatch): Promise<void>;
  abstract shutdown(): Promise<void>;
}

export abstract class WorkflowSource extends Service implements WorkflowSourcePort {
  constructor(context: Context) {
    super(context, 'workflowSource');
  }

  abstract load(source: string): Promise<WorkflowPackage>;
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    workflowTelemetry: WorkflowTelemetry;
    workflowSource: WorkflowSource;
  }
}
