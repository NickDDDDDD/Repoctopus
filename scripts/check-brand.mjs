import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const publicSurfaces = ['app', 'bin', 'docs', 'domains', 'platform', 'workflows'];
const findings = [];

async function scan(relative) {
  const absolute = path.join(root, relative);
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (child.replaceAll('\\', '/') === 'platform/provenance/check.ts') continue;
    if (entry.isDirectory()) await scan(child);
    else if (/\.(?:js|mjs|ts|json|ya?ml)$/i.test(entry.name)) {
      const source = (await readFile(path.join(root, child), 'utf8')).replaceAll(
        'third_party/comet',
        '',
      );
      if (/comet/i.test(source)) findings.push(child.replaceAll('\\', '/'));
    }
  }
}

for (const directory of publicSurfaces) await scan(directory);
const readme = (await readFile(path.join(root, 'README.md'), 'utf8')).replaceAll(
  'third_party/comet',
  '',
);
if (/comet/i.test(readme)) findings.push('README.md');
if (findings.length > 0) {
  throw new Error(
    `Public product surfaces expose upstream product naming:\n${findings.join('\n')}`,
  );
}
process.stdout.write('Verified Repoctopus product naming on public runtime surfaces\n');
