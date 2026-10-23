import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { bootDesktopComposition } from '../app/boot/bootstrap.js';
import { bootApp } from '../app/boot/boot.js';
import { compileComposition } from '../app/boot/composition.js';
import { createRepoctopusBuiltinCatalog } from '../plugins/builtin-catalog.js';
import { FileObservationEnvelopeStore } from '../platform/telemetry/observation-envelope-store.js';
import { DESKTOP_APPLICATION_CONTRACT } from '../services/desktop-application.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

const productRoot = path.resolve(import.meta.dirname, '..');
const cleanup: string[] = [];

afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

async function dataRoot(): Promise<string> {
  const root = await temporaryDirectory('repoctopus-desktop-composition-');
  cleanup.push(root);
  return root;
}

async function postTrace(origin: string, authorization: string): Promise<Response> {
  return fetch(new URL('/v1/traces', origin), {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ resourceSpans: [] }),
  });
}

describe('desktop composition', () => {
  it('boots the Desktop Application through the shared Cordis App Boot', async () => {
    const root = await dataRoot();
    const app = await bootDesktopComposition(productRoot, root);
    try {
      expect(app.composition).toMatchObject({
        id: 'repoctopus-desktop',
        kind: 'desktop',
        requiredServices: [
          'desktopApplication',
          'desktopTelemetryReceiver',
          'observationTelemetry',
        ],
      });
      expect(app.composition.entries.map((entry) => entry.id)).toEqual([
        'desktop-application',
        'desktop-application-service',
        'desktop-otlp-receiver',
        'observation-telemetry-otlp',
      ]);
      expect(app.context.desktopApplication.snapshot()).toEqual({
        apiVersion: DESKTOP_APPLICATION_CONTRACT,
        phase: 'ready',
        projection: {
          schemaVersion: 1,
          version: 0,
          contexts: [],
          workspaceId: null,
          change: null,
          activeChangeId: null,
          run: null,
          stage: null,
          latestSequence: null,
          lastObservedAt: null,
          freshness: 'empty',
          gap: { detected: false, ranges: [] },
        },
      });
      await app.context.desktopTelemetryReceiver.ready();
      const endpoint = app.context.desktopTelemetryReceiver.endpoint();
      expect(endpoint.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
      expect(endpoint.authorization).toMatch(/^Bearer [A-Za-z0-9_-]{43}$/u);
    } finally {
      await app.close();
    }

    const lifecycle = (await new FileObservationEnvelopeStore(root).list()).filter(
      (envelope) => envelope.source.domain === 'lifecycle',
    );
    expect(
      lifecycle.some(
        (envelope) =>
          envelope.source.eventType === 'app.lifecycle' &&
          envelope.attributes['repoctopus.lifecycle.phase'] === 'closed' &&
          envelope.attributes['repoctopus.lifecycle.result'] === 'succeeded',
      ),
    ).toBe(true);
    expect(
      lifecycle.some(
        (envelope) =>
          envelope.source.eventType === 'plugin.lifecycle' &&
          envelope.attributes['repoctopus.lifecycle.phase'] === 'disposed',
      ),
    ).toBe(true);
    expect(JSON.stringify(lifecycle)).not.toContain('observation-telemetry-otlp');
  });

  it('fails closed when the Desktop Application Plugin dependencies are absent', async () => {
    const catalog = await createRepoctopusBuiltinCatalog(productRoot);
    const composition = compileComposition(
      {
        id: 'desktop-missing-dependencies',
        kind: 'desktop',
        plugins: [{ id: 'desktop-application' }],
      },
      catalog,
    );

    await expect(bootApp({ composition, catalog })).rejects.toMatchObject({
      name: 'AppBootError',
      diagnostics: [
        expect.objectContaining({
          code: 'PLUGIN_NOT_ACTIVE',
          pluginId: 'desktop-application',
        }),
      ],
    });
  });

  it('revokes ingress while the Application Fiber is unloaded and restores it on reload', async () => {
    const app = await bootDesktopComposition(productRoot, await dataRoot());
    await app.context.desktopTelemetryReceiver.ready();
    const endpoint = app.context.desktopTelemetryReceiver.endpoint();
    const loaderEntries = app.composition.entries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      ...(entry.config === undefined ? {} : { config: entry.config }),
    }));
    try {
      await expect(postTrace(endpoint.origin, endpoint.authorization)).resolves.toMatchObject({
        status: 200,
      });

      await app.context.loader.root.update(
        loaderEntries.filter((entry) => entry.id !== 'desktop-application'),
      );
      await app.context.loader.await();
      await expect(postTrace(endpoint.origin, endpoint.authorization)).resolves.toMatchObject({
        status: 503,
      });

      await app.context.loader.root.update(loaderEntries);
      await app.context.loader.await();
      await expect(postTrace(endpoint.origin, endpoint.authorization)).resolves.toMatchObject({
        status: 200,
      });
    } finally {
      await app.close();
    }

    await expect(postTrace(endpoint.origin, endpoint.authorization)).rejects.toThrow();
  });
});
