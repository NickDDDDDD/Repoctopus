import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCli } from './cli.js';

const packageRoot = path.resolve(import.meta.dirname, '..', '..');

describe('desktop support CLI', () => {
  it('reports the authoritative current target and complete platform matrix', async () => {
    const result = await runCli<{
      current: { platform: string; architecture: string; status: string };
      matrix: readonly { id: string; status: string }[];
    }>({
      packageRoot,
      cwd: packageRoot,
      args: ['desktop', 'support'],
    });

    expect(result.ok).toBe(true);
    expect(result.command).toBe('desktop support');
    expect(result.result?.current).toMatchObject({
      platform: process.platform,
      architecture: process.arch,
    });
    expect(result.result?.matrix).toHaveLength(6);
    expect(result.result?.matrix.filter((target) => target.status === 'supported')).toEqual([
      expect.objectContaining({ id: 'windows-x64' }),
    ]);
  });
});
