import { Context } from '@deepseek-ai/cordis';
import { describe, expect, it } from 'vitest';

describe('Cordis kernel snapshot', () => {
  it('loads, restarts, and disposes plugin effects', async () => {
    const context = new Context();
    let activations = 0;
    let disposals = 0;

    const fiber = context.plugin((pluginContext) => {
      activations += 1;
      pluginContext.effect(() => () => {
        disposals += 1;
      });
    });

    await fiber.await();
    expect(activations).toBe(1);
    expect(disposals).toBe(0);

    await fiber.restart();
    expect(activations).toBe(2);
    expect(disposals).toBe(1);

    await fiber.dispose();
    expect(disposals).toBe(2);
  });
});
