import { build as buildBundle } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build as buildRenderer } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const desktopRoot = path.join(root, 'app', 'desktop');
const outputRoot = path.join(root, 'dist', 'desktop');
const productSourceFiles = [
  'services/desktop-projection.ts',
  'domains/trajectory/projection.ts',
  'services/desktop-receiver.ts',
  'app/desktop/host/otlp-http-receiver.ts',
  'app/desktop/host/otlp-envelope-codec.ts',
  'services/desktop-application.ts',
  'plugins/application/desktop-application.ts',
];

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
    external: [
      'chromium-bidi/lib/cjs/bidiMapper/BidiMapper',
      'chromium-bidi/lib/cjs/cdp/CdpConnection',
    ],
    platform: 'node',
    target: 'node22',
    format: 'esm',
    banner: {
      js: "import { createRequire as __repoctopusCreateRequire } from 'node:module'; const require = __repoctopusCreateRequire(import.meta.url);",
    },
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
const packagedFiles = [
  ...(await filesUnder(outputRoot)),
  icon,
  ...productSourceFiles.map((relative) => path.join(root, relative)),
].sort((left, right) => left.localeCompare(right));
const resources = await Promise.all(
  packagedFiles.map(async (file) => {
    const bytes = await readFile(file);
    return {
      path:
        file === icon
          ? 'desktop-icon.ico'
          : file.startsWith(outputRoot + path.sep)
            ? path.posix.join('dist/desktop', path.relative(outputRoot, file).replaceAll('\\', '/'))
            : path.posix.join('product', path.relative(root, file).replaceAll('\\', '/')),
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
