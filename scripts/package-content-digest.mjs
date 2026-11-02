import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const BLOCK_SIZE = 512;
const ZERO_BLOCK = Buffer.alloc(BLOCK_SIZE);

function tarString(block, start, length) {
  const end = block.indexOf(0, start);
  return block
    .subarray(start, end === -1 || end > start + length ? start + length : end)
    .toString('utf8');
}

function tarNumber(block, start, length, label) {
  const field = block.subarray(start, start + length);
  if ((field[0] & 0x80) !== 0) {
    throw new Error(`Package tar ${label} uses unsupported base-256 encoding`);
  }
  const text = field.toString('ascii').replace(/\0.*$/u, '').trim();
  if (!/^[0-7]+$/u.test(text)) throw new Error(`Package tar ${label} is invalid`);
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Package tar ${label} is outside the supported range`);
  }
  return value;
}

function verifyHeaderChecksum(block) {
  const expected = tarNumber(block, 148, 8, 'header checksum');
  let actual = 0;
  for (let index = 0; index < block.length; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : block[index];
  }
  if (actual !== expected) throw new Error('Package tar header checksum is invalid');
}

function paxFields(contents) {
  const fields = new Map();
  let offset = 0;
  while (offset < contents.length) {
    const separator = contents.indexOf(0x20, offset);
    if (separator === -1) throw new Error('Package tar PAX record is invalid');
    const length = Number.parseInt(contents.subarray(offset, separator).toString('ascii'), 10);
    if (!Number.isSafeInteger(length) || length <= separator - offset + 2) {
      throw new Error('Package tar PAX record length is invalid');
    }
    const end = offset + length;
    if (end > contents.length || contents[end - 1] !== 0x0a) {
      throw new Error('Package tar PAX record boundary is invalid');
    }
    const record = contents.subarray(separator + 1, end - 1).toString('utf8');
    const equals = record.indexOf('=');
    if (equals <= 0) throw new Error('Package tar PAX field is invalid');
    fields.set(record.slice(0, equals), record.slice(equals + 1));
    offset = end;
  }
  return fields;
}

function packagePath(candidate) {
  const normalized = candidate.replace(/\0+$/u, '');
  if (!normalized.startsWith('package/')) {
    throw new Error(`Package tar entry is outside package/: ${normalized}`);
  }
  const relative = normalized.slice('package/'.length);
  if (
    relative.length === 0 ||
    relative.includes('\\') ||
    path.posix.isAbsolute(relative) ||
    relative.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`Package tar entry path is unsafe: ${normalized}`);
  }
  return relative;
}

function canonicalEntry(entry) {
  return JSON.stringify(entry);
}

/**
 * Computes a package identity from semantic tar entries rather than gzip/tar
 * transport metadata. Paths are sorted; mtimes, uid/gid, header order and
 * compressor details are intentionally excluded.
 */
export function packageContentDigest(archive) {
  if (!Buffer.isBuffer(archive)) throw new Error('Package archive must be a Buffer');
  const tar = gunzipSync(archive);
  const entries = [];
  const seen = new Set();
  let offset = 0;
  let nextPax = new Map();
  let nextLongName = null;
  let nextLongLink = null;

  while (offset + BLOCK_SIZE <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK_SIZE);
    offset += BLOCK_SIZE;
    if (header.equals(ZERO_BLOCK)) break;
    verifyHeaderChecksum(header);

    const size = tarNumber(header, 124, 12, 'entry size');
    const paddedSize = Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
    if (offset + paddedSize > tar.length) throw new Error('Package tar entry is truncated');
    const contents = tar.subarray(offset, offset + size);
    offset += paddedSize;

    const type = String.fromCharCode(header[156] || 0);
    if (type === 'x') {
      nextPax = paxFields(contents);
      continue;
    }
    if (type === 'g') continue;
    if (type === 'L') {
      nextLongName = tarString(contents, 0, contents.length);
      continue;
    }
    if (type === 'K') {
      nextLongLink = tarString(contents, 0, contents.length);
      continue;
    }

    const prefix = tarString(header, 345, 155);
    const headerName = tarString(header, 0, 100);
    const rawName = nextPax.get('path') ?? nextLongName ?? (prefix ? `${prefix}/${headerName}` : headerName);
    const rawLink = nextPax.get('linkpath') ?? nextLongLink ?? tarString(header, 157, 100);
    nextPax = new Map();
    nextLongName = null;
    nextLongLink = null;

    if (type === '5') continue;
    const relative = packagePath(rawName);
    if (seen.has(relative)) throw new Error(`Package tar contains duplicate entry: ${relative}`);
    seen.add(relative);
    const mode = tarNumber(header, 100, 8, 'entry mode') & 0o777;
    if (type === '\0' || type === '0' || type === '7') {
      entries.push({
        path: relative,
        type: 'file',
        mode,
        size,
        sha256: createHash('sha256').update(contents).digest('hex'),
      });
      continue;
    }
    if (type === '1' || type === '2') {
      entries.push({
        path: relative,
        type: type === '1' ? 'hardlink' : 'symlink',
        mode,
        target: rawLink,
      });
      continue;
    }
    throw new Error(`Package tar entry ${relative} has unsupported type ${JSON.stringify(type)}`);
  }

  entries.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  const hash = createHash('sha256');
  hash.update('repoctopus.package-content.v1\0');
  for (const entry of entries) {
    const encoded = Buffer.from(canonicalEntry(entry), 'utf8');
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(encoded.length));
    hash.update(length).update(encoded);
  }
  return {
    sha256: hash.digest('hex'),
    files: entries.length,
    bytes: entries.reduce((total, entry) => total + (entry.type === 'file' ? entry.size : 0), 0),
  };
}
