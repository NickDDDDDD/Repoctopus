import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkProvenance } from '../platform/provenance/check.js';

const productRoot = path.resolve(import.meta.dirname, '..');
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function provenanceFixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'repoctopus-provenance-'));
  temporaryRoots.push(root);
  await cp(path.join(productRoot, 'third_party'), path.join(root, 'third_party'), {
    recursive: true,
  });
  const manifest = JSON.parse(
    await readFile(path.join(productRoot, 'third_party', 'comet', 'source-manifest.json'), 'utf8'),
  ) as { files: Array<{ target: string }> };
  for (const entry of manifest.files) {
    const target = path.join(root, entry.target);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(productRoot, entry.target), target);
  }
  return root;
}

describe('third-party provenance', () => {
  it('accepts the immutable Cordis snapshot', async () => {
    const result = await checkProvenance(await provenanceFixture());
    expect(result.valid).toBe(true);
    expect(result.fileCount).toBe(80);
  });

  it('rejects a modified Cordis source file', async () => {
    const root = await provenanceFixture();
    const target = path.join(root, 'third_party', 'cordis', 'src', 'context.ts');
    await writeFile(target, `${await readFile(target, 'utf8')}\n// modified in test\n`);

    const result = await checkProvenance(root);
    expect(result.valid).toBe(false);
    expect(result.findings).toContain(
      'Cordis snapshot digest mismatch: third_party/cordis/src/context.ts',
    );
  });
});
