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
        requiredServices: ['desktopApplication'],
      });
      expect(app.composition.entries.map((entry) => entry.id)).toEqual([
        'desktop-application',
        'desktop-application-service',
      ]);
      expect(app.context.desktopApplication.snapshot()).toEqual({
        apiVersion: DESKTOP_APPLICATION_CONTRACT,
        phase: 'ready',
      });
    } finally {
      await app.close();
    }
  });
});
