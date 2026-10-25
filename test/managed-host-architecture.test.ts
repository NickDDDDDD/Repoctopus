import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createRepoctopusBuiltinCatalog } from '../plugins/builtin-catalog.js';

const productRoot = path.resolve(import.meta.dirname, '..');

describe('Capturing Work Execution Host boundary', () => {
  it('is test-only and absent from the production plugin catalog', async () => {
    const catalog = await createRepoctopusBuiltinCatalog(productRoot);
    const pluginIds = [...catalog.keys()];

    expect(pluginIds).toContain('work-execution-hosts');
    expect(pluginIds).toContain('managed-work-executor');
    expect(pluginIds).not.toContain('capturing-work-execution-host');
    expect(pluginIds.some((id) => /captur/iu.test(id))).toBe(false);
  });
});
