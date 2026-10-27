import { build as buildBundle } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
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
  mode: 'production',
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    emptyOutDir: false,
    outDir: path.join(outputRoot, 'renderer'),
  },
});

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(target)));
    else files.push(target);
  }
  return files;
}

const icon = path.join(desktopRoot, 'resources', 'icon.ico');
const packagedFiles = [...(await filesUnder(outputRoot)), icon].sort((left, right) =>
  left.localeCompare(right),
);
const resources = await Promise.all(
  packagedFiles.map(async (file) => {
    const bytes = await readFile(file);
    const relative =
      file === icon
        ? 'desktop-icon.ico'
        : path.posix.join('dist/desktop', path.relative(outputRoot, file).replaceAll('\\', '/'));
    return {
      path: relative,
      size: (await stat(file)).size,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }),
);
await writeFile(
  path.join(outputRoot, 'resource-manifest.json'),
  `${JSON.stringify({ schemaVersion: 1, platform: 'win32', arch: 'x64', resources }, null, 2)}\n`,
  'utf8',
);
