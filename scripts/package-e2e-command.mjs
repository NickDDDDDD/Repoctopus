import assert from 'node:assert/strict';
import process from 'node:process';

import { runProcess } from './package-e2e-process.mjs';

const [limit, file, ...args] = process.argv.slice(2);
const timeout = Number(limit);
assert(Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 90_000);
try {
  const result = await runProcess(file, args, {
    timeout,
    rejectOnNonzero: false,
    onSpawn: (child) => {
      child.stdout.pipe(process.stdout);
      child.stderr.pipe(process.stderr);
    },
  });
  process.exitCode = result.code ?? 1;
} catch (error) {
  process.stderr.write(String(error) + '\n');
  process.exitCode = 124;
}
