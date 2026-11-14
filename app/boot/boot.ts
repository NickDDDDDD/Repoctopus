import { pathToFileURL } from 'node:url';

import { randomUUID } from 'node:crypto';

import { Context, type Fiber } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';

import { compositionIdentity, type CompiledComposition } from './composition.js';
import type { BuiltinPluginRegistration } from './descriptor.js';
import { CompositionIdentity } from '../../services/composition-identity.js';
import {
  LifecycleDiagnostics,
  type LifecycleDiagnostic,
  type LifecycleTelemetryEvent,
  type LifecycleTelemetryPort,
} from '../../services/lifecycle-diagnostics.js';

export interface BootDiagnostic {
  code:
    | 'PLUGIN_NOT_REGISTERED'
    | 'PLUGIN_NOT_ACTIVE'
    | 'REQUIRED_SERVICE_MISSING'
    | 'LOADER_FAILED';
  message: string;
  pluginId?: string;
  service?: string;
  cause?: unknown;
}

export class AppBootError extends Error {
  constructor(public readonly diagnostics: readonly BootDiagnostic[]) {
    super(diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
    this.name = 'AppBootError';
  }
}

export interface RunningApp {
  readonly context: Context;
  readonly composition: CompiledComposition;
  readonly lifecycleDiagnostics: readonly LifecycleDiagnostic[];
  readonly lifecycleEvents: readonly LifecycleTelemetryEvent[];
  close(): Promise<void>;
}

export interface BootOptions {
  composition: CompiledComposition;
  catalog: ReadonlyMap<string, BuiltinPluginRegistration>;
  baseUrl?: string;
  lifecycleTelemetry?: LifecycleTelemetryPort;
}

const CORDIS_FIBER_STATE = {
  pending: 0,
  loading: 1,
  active: 2,
  failed: 3,
  disposed: 4,
  unloading: 5,
} as const;

async function disposeRoot(context: Context): Promise<void> {
  const loader = context.get('loader');
  if (loader) {
    await loader.root.update([]);
    await loader.await();
  }
  await context.fiber.dispose();
}

export async function bootApp(options: BootOptions): Promise<RunningApp> {
  const context = new Context();
  const baseUrl = options.baseUrl ?? pathToFileURL(`${process.cwd()}/`).href;
  const loaderFiber = context.plugin(Loader, { baseUrl });
  await loaderFiber;
  new CompositionIdentity(context, compositionIdentity(options.composition));
  const lifecycleDiagnostics = new LifecycleDiagnostics(
    context,
    { bootId: randomUUID(), compositionDigest: options.composition.compositionDigest },
    options.lifecycleTelemetry,
  );
  lifecycleDiagnostics.event({
    type: 'app.lifecycle',
    phase: 'boot',
    result: 'started',
  });
  const phaseByState: Record<number, LifecycleTelemetryEvent['phase']> = {
    [CORDIS_FIBER_STATE.pending]: 'pending',
    [CORDIS_FIBER_STATE.loading]: 'loading',
    [CORDIS_FIBER_STATE.active]: 'active',
    [CORDIS_FIBER_STATE.failed]: 'failed',
    [CORDIS_FIBER_STATE.disposed]: 'disposed',
    [CORDIS_FIBER_STATE.unloading]: 'unloading',
  };
  const pluginId = (fiber: Fiber): string | undefined =>
    options.composition.entries.find((entry) => {
      try {
        return context.loader.resolve(entry.id).fiber === fiber;
      } catch {
        return false;
      }
    })?.id;
  context.on(
    'internal/status',
    (fiber) => {
      const id = pluginId(fiber);
      if (!id) return;
      const state = Number(fiber.state);
      lifecycleDiagnostics.event({
        type: 'plugin.lifecycle',
        phase: phaseByState[state] ?? 'failed',
        result: state === CORDIS_FIBER_STATE.failed ? 'failed' : 'succeeded',
        pluginId: id,
      });
    },
    { global: true },
  );

  const diagnostics: BootDiagnostic[] = [];
  for (const entry of options.composition.entries) {
    const registration = options.catalog.get(entry.id);
    if (!registration) {
      diagnostics.push({
        code: 'PLUGIN_NOT_REGISTERED',
        pluginId: entry.id,
        message: `Compiled plugin is no longer registered: ${entry.id}`,
      });
      continue;
    }
    context.loader.builtins[entry.id] = registration.plugin;
  }

  if (diagnostics.length === 0) {
    try {
      await context.loader.root.update(
        options.composition.entries.map((entry) => ({
          id: entry.id,
          name: entry.name,
          ...(entry.config === undefined ? {} : { config: entry.config }),
        })),
      );
      await context.loader.await();
    } catch (cause) {
      diagnostics.push({
        code: 'LOADER_FAILED',
        message: 'Cordis Loader failed while activating the composition',
        cause,
      });
    }
  }

  for (const entry of options.composition.entries) {
    try {
      const loaded = context.loader.resolve(entry.id);
      if (!loaded.fiber?.uid || Number(loaded.fiber.state) !== CORDIS_FIBER_STATE.active) {
        diagnostics.push({
          code: 'PLUGIN_NOT_ACTIVE',
          pluginId: entry.id,
          message: `Plugin failed to become active: ${entry.id}`,
        });
      }
    } catch (cause) {
      diagnostics.push({
        code: 'PLUGIN_NOT_ACTIVE',
        pluginId: entry.id,
        message: `Plugin was not created by Loader: ${entry.id}`,
        cause,
      });
    }
  }

  for (const service of options.composition.requiredServices) {
    if (context.get(service) === undefined) {
      diagnostics.push({
        code: 'REQUIRED_SERVICE_MISSING',
        service,
        message: `Composition did not activate required service: ${service}`,
      });
    }
  }

  if (diagnostics.length > 0) {
    lifecycleDiagnostics.event({
      type: 'app.lifecycle',
      phase: 'failed',
      result: 'failed',
    });
    await disposeRoot(context);
    await lifecycleDiagnostics.flush();
    throw new AppBootError(diagnostics);
  }

  lifecycleDiagnostics.event({
    type: 'app.lifecycle',
    phase: 'active',
    result: 'succeeded',
  });
  lifecycleDiagnostics.bindCanonicalTelemetry();
  const observationDelivery = context.get('observationDelivery');
  observationDelivery?.deferRemoteUntilClose();

  let closed = false;
  return {
    context,
    composition: options.composition,
    get lifecycleDiagnostics() {
      return lifecycleDiagnostics.snapshot();
    },
    get lifecycleEvents() {
      return lifecycleDiagnostics.eventSnapshot();
    },
    async close() {
      if (closed) return;
      closed = true;
      lifecycleDiagnostics.event({
        type: 'app.lifecycle',
        phase: 'unloading',
        result: 'started',
      });
      await disposeRoot(context);
      lifecycleDiagnostics.event({
        type: 'app.lifecycle',
        phase: 'closed',
        result: 'succeeded',
      });
      await lifecycleDiagnostics.flush();
      await observationDelivery?.flushRemote().catch(() => {
        lifecycleDiagnostics.record({
          code: 'OBSERVATION_REMOTE_FLUSH_FAILED',
          service: 'observationDelivery',
          timestamp: new Date().toISOString(),
        });
      });
    },
  };
}
