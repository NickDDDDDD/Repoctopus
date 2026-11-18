import { mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

type Runner = {
  runProcess(
    this: void,
    file: string,
    args: string[],
    options: { timeout: number },
  ): Promise<unknown>;
};

describe('package acceptance process timeout', () => {
  it.each([0, 1, 2])('preserves command JSON streams and exit code %i', (code) => {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('../scripts/package-e2e-command.mjs', import.meta.url)),
        '5000',
        process.execPath,
        '-e',
        'process.stdout.write("{\\"ok\\":true}");process.stderr.write("{\\"diagnostic\\":true}");process.exitCode=' +
          code,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 10_000 },
    );
    expect(result.status).toBe(code);
    expect(result.stdout).toBe('{"ok":true}');
    expect(result.stderr).toBe('{"diagnostic":true}');
  });

  it.skipIf(process.platform !== 'win32').each(['runner', 'command-supervisor'])(
    'terminates descendants before timing out through %s',
    async (mode) => {
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
        const arguments_ =
          mode === 'runner'
            ? ['-e', parent]
            : [
                fileURLToPath(new URL('../scripts/package-e2e-command.mjs', import.meta.url)),
                '350',
                process.execPath,
                '-e',
                parent,
              ];
        await expect(
          runProcess(process.execPath, arguments_, { timeout: mode === 'runner' ? 350 : 5_000 }),
        ).rejects.toThrow(/timed out/u);
        await delay(1_400);
        await expect(readFile(marker)).rejects.toThrow();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
