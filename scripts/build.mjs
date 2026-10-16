import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'dist', 'repoctopus.mjs');
const manifest = path.join(root, 'dist', 'manifest.json');
const check = process.argv.includes('--check');

async function buildInto(target) {
  await build({
    entryPoints: [path.join(root, 'app', 'cli', 'main.ts')],
    outfile: target,
    bundle: true,
    packages: 'external',
    platform: 'node',
    target: 'node22',
    format: 'esm',
    sourcemap: false,
    legalComments: 'eof',
    banner: { js: '#!/usr/bin/env node' },
  });
}

if (check) {
  const temporary = `${output}.check-${process.pid}`;
  await buildInto(temporary);
  try {
    const [expected, actual] = await Promise.all([readFile(output), readFile(temporary)]);
    if (!expected.equals(actual))
      throw new Error('dist/repoctopus.mjs is stale; run npm run build');
  } finally {
    await rm(temporary, { force: true });
  }
} else {
  await mkdir(path.dirname(output), { recursive: true });
  await buildInto(output);
  const contents = await readFile(output);
  await writeFile(
    manifest,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        file: 'repoctopus.mjs',
        sha256: createHash('sha256').update(contents).digest('hex'),
      },
      null,
      2,
    )}\n`,
  );
  await mkdir(path.join(root, 'dist', 'workflows'), { recursive: true });
  await cp(
    path.join(root, 'workflows', 'foundation.yaml'),
    path.join(root, 'dist', 'workflows', 'foundation.yaml'),
  );
}
