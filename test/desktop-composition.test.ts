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
        requiredServices: ['desktopApplication', 'desktopTelemetryReceiver'],
      });
      expect(app.composition.entries.map((entry) => entry.id)).toEqual([
        'desktop-application',
        'desktop-application-service',
        'desktop-otlp-receiver',
      ]);
      expect(app.context.desktopApplication.snapshot()).toEqual({
        apiVersion: DESKTOP_APPLICATION_CONTRACT,
        phase: 'ready',
        projection: {
          schemaVersion: 1,
          version: 0,
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
  });
});
