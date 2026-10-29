import { Buffer } from 'node:buffer';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { deflateSync } from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'app', 'desktop', 'resources', 'icon.ico');
const size = 256;

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  name.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return result;
}

function insideRoundedSquare(x, y) {
  const radius = 56;
  if (x >= radius && x < size - radius) return true;
  if (y >= radius && y < size - radius) return true;
  const centerX = x < radius ? radius : size - radius - 1;
  const centerY = y < radius ? radius : size - radius - 1;
  return (x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2;
}

function inBar(x, y) {
  return (
    (x >= 58 && x < 198 && y >= 62 && y < 96) ||
    (x >= 58 && x < 150 && y >= 112 && y < 146) ||
    (x >= 58 && x < 198 && y >= 162 && y < 196)
  );
}

function png() {
  const stride = size * 4 + 1;
  const pixels = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * stride;
    for (let x = 0; x < size; x += 1) {
      const offset = row + 1 + x * 4;
      const color = inBar(x, y)
        ? [0x72, 0xd6, 0xbc, 0xff]
        : insideRoundedSquare(x, y)
          ? [0x18, 0x21, 0x2f, 0xff]
          : [0, 0, 0, 0];
      pixels.set(color, offset);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function ico() {
  const image = png();
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(image.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, image]);
}

const expected = ico();
if (process.argv.includes('--check')) {
  await access(output);
  const actual = await readFile(output);
  if (!actual.equals(expected)) throw new Error('Desktop icon is not the generated asset');
  process.stdout.write('Verified deterministic Windows icon\n');
} else {
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, expected);
  process.stdout.write(`Generated ${path.relative(root, output)}\n`);
}
