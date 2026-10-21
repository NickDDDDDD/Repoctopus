import process from 'node:process';

import type { Context, Plugin } from '@deepseek-ai/cordis';

import { bootApp } from '../../app/boot/boot.js';
import { compileComposition } from '../../app/boot/composition.js';
import { PLUGIN_CONTRACT_VERSION } from '../../app/boot/descriptor.js';
import { createRepoctopusBuiltinCatalog } from '../../plugins/builtin-catalog.js';

const [mode, productRoot, workspaceRoot] = process.argv.slice(2);
if (!mode || !productRoot || !workspaceRoot) {
  throw new Error('Usage: platform-event-process <ingress|runner> <product-root> <workspace-root>');
}

const catalog = new Map(await createRepoctopusBuiltinCatalog(productRoot));

if (mode === 'ingress') {
  const composition = compileComposition(
    {
      id: 'platform-event-recovery-ingress',
      kind: 'project',
      plugins: [
        { id: 'http-host', config: { hostname: '127.0.0.1', port: 0 } },
        { id: 'platform-events-file', config: { workspaceRoot } },
        {
          id: 'github-webhook-route',
          config: { source: 'recovery-fixture', maxBodyBytes: 65_536 },
        },
      ],
      requiredServices: ['httpHost', 'platformEvents'],
    },
    catalog,
  );
  const app = await bootApp({ composition, catalog });
  await app.context.httpHost.ready();
  process.stdout.write(
    `${JSON.stringify({ type: 'ready', origin: app.context.httpHost.origin() })}\n`,
  );

  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    void app.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
} else if (mode === 'runner') {
  const processor = Object.assign(
    ((context: Context) => {
      context.effect(() =>
        context.platformEvents.register({
          id: 'recovery-fixture-processor',
          provider: 'github',
          eventType: 'pull_request',
          process: () => Promise.resolve({ result: 'completed' }),
        }),
      );
    }) as Plugin,
    { inject: ['platformEvents'] },
  );
  catalog.set('recovery-fixture-processor', {
    descriptor: {
      id: 'recovery-fixture-processor',
      version: '1.0.0',
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'contributor',
      source: 'builtin',
      codeDigest: `sha256:${'e'.repeat(64)}`,
      compositions: ['project'],
      authorities: [],
      permissions: [],
      stateSchemas: {},
    },
    plugin: processor,
  });
  const composition = compileComposition(
    {
      id: 'platform-event-recovery-runner',
      kind: 'project',
      plugins: [
        { id: 'platform-events-file', config: { workspaceRoot } },
        {
          id: 'platform-event-runner',
          config: {
            owner: 'recovery-fixture-runner',
            pollIntervalMs: 60_000,
            leaseMs: 5_000,
          },
        },
        { id: 'recovery-fixture-processor' },
      ],
      requiredServices: ['platformEvents', 'platformEventRunner'],
    },
    catalog,
  );
  const app = await bootApp({ composition, catalog });
  try {
    const result = await app.context.platformEventRunner.runOnce();
    process.stdout.write(`${JSON.stringify({ type: 'processed', ...result })}\n`);
  } finally {
    await app.close();
  }
} else {
  throw new Error(`Unknown platform-event fixture mode: ${mode}`);
}
