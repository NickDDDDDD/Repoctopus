import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { bootApp } from '../app/boot/boot.js';
import { bootDesktopComposition } from '../app/boot/bootstrap.js';
import { compileComposition } from '../app/boot/composition.js';
import { createRepoctopusBuiltinCatalog } from '../plugins/builtin-catalog.js';
import { DESKTOP_APPLICATION_CONTRACT } from '../services/desktop-application.js';

const productRoot = path.resolve(import.meta.dirname, '..');

describe('desktop composition', () => {
  it('boots the Desktop Application through the shared Cordis App Boot', async () => {
    const app = await bootDesktopComposition(productRoot);
    try {
      expect(app.composition).toMatchObject({
        id: 'repoctopus-desktop',
        kind: 'desktop',
        requiredServices: ['desktopApplication', 'desktopProjection', 'desktopReceiver'],
      });
      expect(app.composition.entries.map((entry) => entry.id)).toEqual([
        'desktop-application',
        'desktop-application-service',
        'desktop-projection-service',
        'desktop-receiver-service',
      ]);
      expect(app.context.desktopApplication.snapshot()).toEqual({
        apiVersion: DESKTOP_APPLICATION_CONTRACT,
        phase: 'ready',
      });
      expect(app.context.desktopProjection.snapshot()).toMatchObject({
        schemaVersion: 1,
        version: 0,
      });
      const connection = app.context.desktopReceiver.connection();
      expect(connection.schemaVersion).toBe(1);
      expect(connection.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
    } finally {
      await app.close();
    }
  });

  it('fails closed when an Application Plugin dependency is missing', async () => {
    const catalog = await createRepoctopusBuiltinCatalog(productRoot);
    const composition = compileComposition(
      {
        id: 'desktop-missing-receiver',
        kind: 'desktop',
        plugins: [
          { id: 'desktop-application-service' },
          { id: 'desktop-projection-service' },
          { id: 'desktop-application' },
        ],
        requiredServices: ['desktopApplication', 'desktopProjection'],
      },
      catalog,
    );

    await expect(bootApp({ composition, catalog })).rejects.toThrow(
      /Loader failed|failed to become active/iu,
    );
  });

  it('stops the Receiver when the Application Plugin is uninstalled', async () => {
    const app = await bootDesktopComposition(productRoot);
    const endpoint = app.context.desktopReceiver.connection().endpoint;
    try {
      await app.context.loader.root.update(
        app.composition.entries
          .filter((entry) => entry.id !== 'desktop-application')
          .map((entry) => ({
            id: entry.id,
            name: entry.name,
            ...(entry.config === undefined ? {} : { config: entry.config }),
          })),
      );
      await app.context.loader.await();
      await expect(fetch(`${endpoint}/v1/logs`)).rejects.toThrow();
    } finally {
      await app.close();
    }
  });

  it('creates a fresh Receiver while preserving one composition per Host restart', async () => {
    const first = await bootDesktopComposition(productRoot);
    const firstConnection = first.context.desktopReceiver.connection();
    await first.close();

    const second = await bootDesktopComposition(productRoot);
    try {
      const secondConnection = second.context.desktopReceiver.connection();
      expect(secondConnection.endpoint).not.toBe(firstConnection.endpoint);
      expect(secondConnection.sessionToken).not.toBe(firstConnection.sessionToken);
      expect(second.composition.id).toBe('repoctopus-desktop');
    } finally {
      await second.close();
    }
  });
});
