import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { packageContentDigest } from '../scripts/package-content-digest.mjs';

const BLOCK_SIZE = 512;

function octal(value: number, width: number): Buffer {
  return Buffer.from(`${value.toString(8).padStart(width - 1, '0')}\0`, 'ascii');
}

function tarArchive(files: ReadonlyArray<{ path: string; contents: string }>, mtime: number): Buffer {
  const blocks: Buffer[] = [];
  for (const file of files) {
    const contents = Buffer.from(file.contents, 'utf8');
    const header = Buffer.alloc(BLOCK_SIZE);
    header.write(`package/${file.path}`, 0, 100, 'utf8');
    octal(0o644, 8).copy(header, 100);
    octal(0, 8).copy(header, 108);
    octal(0, 8).copy(header, 116);
    octal(contents.length, 12).copy(header, 124);
    octal(mtime, 12).copy(header, 136);
    header.fill(0x20, 148, 156);
    header[156] = '0'.charCodeAt(0);
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');
    octal([...header].reduce((sum, byte) => sum + byte, 0), 8).copy(header, 148);
    blocks.push(header, contents);
    const padding = (BLOCK_SIZE - (contents.length % BLOCK_SIZE)) % BLOCK_SIZE;
    if (padding > 0) blocks.push(Buffer.alloc(padding));
  }
  blocks.push(Buffer.alloc(BLOCK_SIZE * 2));
  return gzipSync(Buffer.concat(blocks));
}

describe('packageContentDigest', () => {
  it('ignores transport metadata and file order while binding packaged contents', () => {
    const first = tarArchive(
      [
        { path: 'dist/cli.js', contents: 'cli' },
        { path: 'package.json', contents: '{"name":"repoctopus"}\n' },
      ],
      1,
    );
    const reordered = tarArchive(
      [
        { path: 'package.json', contents: '{"name":"repoctopus"}\n' },
        { path: 'dist/cli.js', contents: 'cli' },
      ],
      2,
    );
    expect(createHash('sha256').update(first).digest('hex')).not.toBe(
      createHash('sha256').update(reordered).digest('hex'),
    );

    const firstDigest = packageContentDigest(first);
    expect(packageContentDigest(reordered)).toEqual(firstDigest);
    expect(firstDigest).toMatchObject({ files: 2, bytes: 25 });

    const changed = tarArchive(
      [
        { path: 'dist/cli.js', contents: 'changed' },
        { path: 'package.json', contents: '{"name":"repoctopus"}\n' },
      ],
      2,
    );
    expect(packageContentDigest(changed).sha256).not.toBe(firstDigest.sha256);
  });
});
