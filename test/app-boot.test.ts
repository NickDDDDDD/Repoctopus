import { Service, type Context, type Plugin } from '@deepseek-ai/cordis';
import { describe, expect, it } from 'vitest';

import { bootApp } from '../app/boot/boot.js';
import { compileComposition } from '../app/boot/composition.js';
import {
  createBuiltinCatalog,
  PLUGIN_CONTRACT_VERSION,
  type BuiltinPluginRegistration,
} from '../app/boot/descriptor.js';
import {
  bindOperationOwnership,
  type OperationOwnership,
} from '../services/operation-ownership.js';
import { InMemoryLifecycleTelemetryExporter } from '../platform/telemetry/opentelemetry/exporter.js';

const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

function registration(
  id: string,
  plugin: Plugin,
  options: {
    authorities?: readonly string[];
    compositions?: readonly ('bootstrap' | 'project')[];
  } = {},
): BuiltinPluginRegistration {
  return {
    descriptor: {
      id,
      version: '1.0.0',
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      codeDigest: digest(id === 'project-test' ? 'a' : 'b'),
      compositions: options.compositions ?? ['bootstrap', 'project'],
      authorities: options.authorities ?? [],
      permissions: [],
      stateSchemas: {},
    },
    plugin,
  };
}

class ProjectTestService extends Service {
  constructor(context: Context) {
    super(context, 'projectTest');
  }

  probe() {
    return 'ready';
  }
}

class DrainingTestService extends Service {
  private readonly operations: OperationOwnership;

  constructor(context: Context) {
    super(context, 'drainingTest');
    this.operations = bindOperationOwnership(context, 'drainingTest', 5);
  }

  hold(release: Promise<void>): Promise<void> {
    return this.operations.run({ cancellable: true }, async ({ markDurableBoundary }) => {
      markDurableBoundary();
      await release;
    });
  }
}

describe('Repoctopus App Boot', () => {
  it('starts a bootstrap composition without a product Runtime and releases effects', async () => {
    const resources = new Set<string>();
    let activations = 0;
    let disposals = 0;
    const projectPlugin = Object.assign(
      (context: Context) => {
        activations += 1;
        resources.add('project');
        new ProjectTestService(context);
        context.effect(() => () => {
          resources.delete('project');
          disposals += 1;
        });
      },
      { provide: 'projectTest' },
    );
    const catalog = createBuiltinCatalog([registration('project-test', projectPlugin)]);
    const composition = compileComposition(
      {
        id: 'bootstrap',
        kind: 'bootstrap',
        plugins: [{ id: 'project-test' }],
        requiredServices: ['projectTest'],
      },
      catalog,
    );

    const first = await bootApp({ composition, catalog });
    expect(first.context.compositionIdentity.current()).toMatchObject({
      id: 'bootstrap',
      compositionDigest: composition.compositionDigest,
      plugins: [expect.objectContaining({ id: 'project-test' })],
    });
    expect((first.context.get('projectTest') as ProjectTestService).probe()).toBe('ready');
    expect(resources).toEqual(new Set(['project']));
    await first.close();
    expect(resources.size).toBe(0);

    const second = await bootApp({ composition, catalog });
    expect(activations).toBe(2);
    await second.close();
    await second.close();
    expect(disposals).toBe(2);
    expect(resources.size).toBe(0);
  });

  it('reports a required product service that the composition did not activate', async () => {
    const catalog = createBuiltinCatalog([registration('project-test', () => undefined)]);
    const composition = compileComposition(
      {
        id: 'broken',
        kind: 'bootstrap',
        plugins: [{ id: 'project-test' }],
        requiredServices: ['projectTest'],
      },
      catalog,
    );

    await expect(bootApp({ composition, catalog })).rejects.toMatchObject({
      name: 'AppBootError',
      diagnostics: [
        expect.objectContaining({
          code: 'REQUIRED_SERVICE_MISSING',
          service: 'projectTest',
        }),
      ],
    });
  });

  it('lets Cordis keep a plugin pending until its declared Service dependency appears', async () => {
    const events: string[] = [];
    const consumer = Object.assign(
      () => {
        events.push('consumer');
      },
      { inject: ['projectTest'] },
    );
    const provider = Object.assign(
      (context: Context) => {
        events.push('provider');
        new ProjectTestService(context);
      },
      { provide: 'projectTest' },
    );
    const catalog = createBuiltinCatalog([
      registration('consumer-test', consumer),
      registration('project-test', provider),
    ]);
    const composition = compileComposition(
      {
        id: 'dependency-order',
        kind: 'bootstrap',
        plugins: [{ id: 'consumer-test' }, { id: 'project-test' }],
        requiredServices: ['projectTest'],
      },
      catalog,
    );

    const app = await bootApp({ composition, catalog });
    expect(events).toContain('provider');
    expect(events).toContain('consumer');
    await app.close();
  });

  it('reloads an ordinary plugin through Loader and disposes the previous Fiber first', async () => {
    const events: string[] = [];
    const reloadable = ((context: Context, config: { label: string }) => {
      context.effect(() => {
        events.push(`start:${config.label}`);
        return () => events.push(`stop:${config.label}`);
      });
    }) as Plugin;
    const catalog = createBuiltinCatalog([registration('reloadable-test', reloadable)]);
    const telemetry = new InMemoryLifecycleTelemetryExporter();
    const composition = compileComposition(
      {
        id: 'reload',
        kind: 'bootstrap',
        plugins: [{ id: 'reloadable-test', config: { label: 'one' } }],
      },
      catalog,
    );
    const app = await bootApp({ composition, catalog, lifecycleTelemetry: telemetry });

    await app.context.loader.root.update([
      { id: 'reloadable-test', name: 'cordis:reloadable-test', config: { label: 'two' } },
    ]);
    await app.context.loader.await();

    expect(events).toEqual(['start:one', 'stop:one', 'start:two']);
    await app.close();
    expect(events).toEqual(['start:one', 'stop:one', 'start:two', 'stop:two']);
    expect(telemetry.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'plugin.lifecycle',
          pluginId: 'reloadable-test',
          phase: 'active',
          result: 'succeeded',
        }),
        expect.objectContaining({
          type: 'app.lifecycle',
          phase: 'closed',
          result: 'succeeded',
        }),
      ]),
    );
  });

  it('records a recoverable diagnostic when a durable operation exceeds bounded shutdown', async () => {
    let service!: DrainingTestService;
    let release!: () => void;
    const durableOperation = new Promise<void>((resolve) => {
      release = resolve;
    });
    const plugin = Object.assign(
      (context: Context) => {
        service = new DrainingTestService(context);
      },
      { provide: 'drainingTest' },
    );
    const catalog = createBuiltinCatalog([registration('draining-test', plugin)]);
    const composition = compileComposition(
      {
        id: 'bounded-drain',
        kind: 'bootstrap',
        plugins: [{ id: 'draining-test' }],
        requiredServices: ['drainingTest'],
      },
      catalog,
    );
    const app = await bootApp({ composition, catalog });
    const running = service.hold(durableOperation);

    await app.close();

    expect(app.lifecycleDiagnostics).toEqual([
      expect.objectContaining({
        code: 'OPERATION_DRAIN_TIMEOUT',
        service: 'drainingTest',
        remaining: 1,
        recoverability: 'journal_or_checkpoint',
      }),
    ]);
    release();
    await running;
  });

  it('bounds lifecycle telemetry retries without changing the app close result', async () => {
    const plugin = Object.assign(
      (context: Context) => {
        new ProjectTestService(context);
      },
      { provide: 'projectTest' },
    );
    const catalog = createBuiltinCatalog([registration('project-test', plugin)]);
    const composition = compileComposition(
      {
        id: 'telemetry-failure',
        kind: 'bootstrap',
        plugins: [{ id: 'project-test' }],
        requiredServices: ['projectTest'],
      },
      catalog,
    );
    let attempts = 0;
    const app = await bootApp({
      composition,
      catalog,
      lifecycleTelemetry: {
        export() {
          attempts += 1;
          return Promise.reject(new Error('sensitive backend failure'));
        },
      },
    });

    await expect(app.close()).resolves.toBeUndefined();

    expect(attempts).toBe(2);
    expect(app.lifecycleDiagnostics).toContainEqual(
      expect.objectContaining({
        code: 'LIFECYCLE_TELEMETRY_EXPORT_FAILED',
        service: 'lifecycleTelemetry',
        attempts: 2,
        disposition: 'dropped_after_retry',
      }),
    );
    expect(JSON.stringify(app.lifecycleDiagnostics)).not.toContain('sensitive backend failure');
  });
});
