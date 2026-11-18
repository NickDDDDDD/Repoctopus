import { mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

type Runner = {
  runProcess(
    this: void,
    file: string,
    args: string[],
    options: { timeout: number },
  ): Promise<string>;
};

describe('package acceptance process timeout', () => {
  it.skipIf(process.platform !== 'win32')('terminates descendants before timing out', async () => {
    const directory = path.join(os.tmpdir(), 'rp-timeout-' + process.pid);
    const marker = path.join(directory, 'survived.txt');
    await mkdir(directory, { recursive: true });
    try {
      const { runProcess } = (await import(
        new URL('../scripts/package-e2e-process.mjs', import.meta.url).href
      )) as Runner;
      const descendant =
        'setTimeout(() => require("node:fs").writeFileSync(' +
        JSON.stringify(marker) +
        ', "survived"), 1200)';
      const parent =
        'require("node:child_process").spawn(process.execPath, ["-e", ' +
        JSON.stringify(descendant) +
        '], {stdio:"inherit"}); setInterval(() => {}, 1000)';
      await expect(runProcess(process.execPath, ['-e', parent], { timeout: 350 })).rejects.toThrow(
        /timed out/u,
      );
      await delay(1_400);
      await expect(readFile(marker)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
