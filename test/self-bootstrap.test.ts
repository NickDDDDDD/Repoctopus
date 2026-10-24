import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { bootProjectComposition } from '../app/boot/bootstrap.js';

const productRoot = path.resolve(import.meta.dirname, '..');

describe('Repoctopus self bootstrap', () => {
  it('boots the checked-in project composition and reloads an Evidence Contributor', async () => {
    const app = await bootProjectComposition(productRoot, productRoot);
    try {
      const before = app.context.loader.resolve('evidence-command-local').fiber?.uid;
      const lifecycleCount = app.lifecycleEvents.length;
      await app.context.loader.root.update(
        app.composition.entries.map((entry) => ({
          id: entry.id,
          name: entry.name,
          ...(entry.id === 'evidence-command-local'
            ? { config: { reloadProbe: 'self-bootstrap' } }
            : entry.config === undefined
              ? {}
              : { config: entry.config }),
        })),
      );
      await app.context.loader.await();
      const after = app.context.loader.resolve('evidence-command-local').fiber?.uid;
      const result = await app.context.commandRouter.execute<
        { profileId: string },
        { plan: { profileId: string; nodes: readonly unknown[] } }
      >('evidence.plan', { profileId: 'verify' });

      expect(before).toBeDefined();
      expect(after).toBeDefined();
      expect(after).toBe(before);
      expect(app.lifecycleEvents.slice(lifecycleCount)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'plugin.lifecycle',
            pluginId: 'evidence-command-local',
            phase: 'unloading',
          }),
          expect.objectContaining({
            type: 'plugin.lifecycle',
            pluginId: 'evidence-command-local',
            phase: 'active',
          }),
        ]),
      );
      expect(result.plan).toMatchObject({ profileId: 'verify' });
      expect(result.plan.nodes.length).toBeGreaterThan(0);
      expect(app.context.get('consistencyReconciler')).toBeDefined();
    } finally {
      await app.close();
    }
  });
});
