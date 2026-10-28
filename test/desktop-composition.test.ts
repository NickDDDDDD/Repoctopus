import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { bootDesktopComposition } from '../app/boot/bootstrap.js';
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
        protocolVersion: 1,
        phase: 'ready',
        activeContext: null,
      });
      app.context.desktopApplication.activate({
        schemaVersion: 1,
        workspaceId: 'team-platform',
        changeId: 'add-dashboard',
        runId: 'run-dashboard',
      });
      expect(app.context.desktopApplication.snapshot()).toMatchObject({
        activeContext: { workspaceId: 'team-platform', changeId: 'add-dashboard' },
      });
      const receiver = await app.context.desktopReceiver.start();
      expect(receiver.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
      expect(app.context.desktopProjection.snapshot()).toMatchObject({
        schemaVersion: 1,
        version: 0,
        freshness: { status: 'empty' },
      });
    } finally {
      await app.close();
    }
  });
});
