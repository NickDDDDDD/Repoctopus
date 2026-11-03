import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { OpenSpecProcess } from '../platform/specification/openspec-process.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

async function script(contents: string): Promise<{ root: string; file: string }> {
  const root = await temporaryDirectory('repoctopus-openspec-process-');
  cleanup.push(root);
  const file = path.join(root, 'fixture.mjs');
  await writeFile(file, contents);
  return { root, file };
}

describe('OpenSpec process diagnostics', () => {
  it('classifies timeout without throwing away the process result', async () => {
    const fixture = await script('setInterval(() => {}, 1_000);\n');
    const result = await new OpenSpecProcess(fixture.file, 20).execute([], {
      cwd: fixture.root,
    });

    expect(result).toMatchObject({ exitCode: 1, failureKind: 'timeout' });
  });

  it('classifies caller abort separately from timeout', async () => {
    const fixture = await script('setInterval(() => {}, 1_000);\n');
    const controller = new AbortController();
    const pending = new OpenSpecProcess(fixture.file, 10_000).execute([], {
      cwd: fixture.root,
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).resolves.toMatchObject({ exitCode: 1, failureKind: 'aborted' });
  });

  it('keeps an ordinary command failure distinct from infrastructure failure', async () => {
    const fixture = await script(
      'process.stderr.write("invalid invocation\\n"); process.exit(7);\n',
    );
    const result = await new OpenSpecProcess(fixture.file).execute([], { cwd: fixture.root });

    expect(result).toMatchObject({
      exitCode: 7,
      failureKind: 'non-zero-exit',
      stderr: 'invalid invocation\n',
    });
  });
});
