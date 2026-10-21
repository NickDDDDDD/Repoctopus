import { build as buildBundle } from 'esbuild';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { build as buildRenderer } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const desktopRoot = path.join(root, 'app', 'desktop');
const outputRoot = path.join(root, 'dist', 'desktop');

await rm(outputRoot, { recursive: true, force: true });

await Promise.all([
  buildBundle({
    entryPoints: [path.join(desktopRoot, 'main', 'main.ts')],
    outfile: path.join(outputRoot, 'main.js'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    external: ['electron'],
    legalComments: 'eof',
  }),
  buildBundle({
    entryPoints: [path.join(desktopRoot, 'preload', 'main.ts')],
    outfile: path.join(outputRoot, 'preload.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['electron'],
    legalComments: 'eof',
  }),
  buildBundle({
    entryPoints: [path.join(desktopRoot, 'host', 'main.ts')],
    outfile: path.join(outputRoot, 'host.mjs'),
    bundle: true,
    packages: 'external',
    platform: 'node',
    target: 'node22',
    format: 'esm',
    legalComments: 'eof',
  }),
]);

await buildRenderer({
  configFile: false,
  root: path.join(desktopRoot, 'renderer'),
  base: './',
  build: {
    emptyOutDir: false,
    outDir: path.join(outputRoot, 'renderer'),
  },
});
