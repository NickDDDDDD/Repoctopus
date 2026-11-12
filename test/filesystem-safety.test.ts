import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  atomicWriteText,
  prepareContainedFileCleanup,
} from '../platform/filesystem/atomic-write.js';
import { readFileRaceSafe } from '../platform/filesystem/race-safe-read.js';

describe('filesystem safety primitives', () => {
  let root: string;
  let outside: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoctopus-filesystem-'));
    outside = await fs.mkdtemp(path.join(os.tmpdir(), 'repoctopus-filesystem-outside-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  it.skipIf(process.platform === 'win32')(
    'rejects a regular file replaced while it is being read',
    async () => {
      const file = path.join(root, 'state.json');
      const replacement = path.join(root, 'replacement.json');
      await fs.writeFile(file, 'original');
      await fs.writeFile(replacement, 'replacement');

      await expect(
        readFileRaceSafe(file, 1024, {
          hooks: {
            afterOpen: async () => {
              await fs.rename(replacement, file);
            },
          },
        }),
      ).rejects.toMatchObject({ reason: 'changed' });
    },
  );

  it('rejects a temporary file replaced before an atomic commit', async () => {
    const target = path.join(root, 'state.json');
    await expect(
      atomicWriteText(target, 'original', {
        containedRoot: root,
        beforeCommit: async () => {
          const temporary = (await fs.readdir(root)).find((entry) => entry.endsWith('.tmp'));
          if (!temporary) throw new Error('temporary file not found');
          const temporaryPath = path.join(root, temporary);
          await fs.unlink(temporaryPath);
          await fs.writeFile(temporaryPath, 'tampered');
        },
      }),
    ).rejects.toThrow(/temporary file changed before commit/u);
    await expect(fs.readFile(target, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects cleanup when the original file is reached through a replaced parent', async () => {
    const parent = path.join(root, 'entry');
    const displaced = path.join(outside, 'entry');
    const file = path.join(parent, 'staged.tmp');
    await fs.mkdir(parent);
    await fs.writeFile(file, 'original staging bytes');
    const cleanup = await prepareContainedFileCleanup(file, root);
    await fs.rename(parent, displaced);
    await fs.symlink(displaced, parent, process.platform === 'win32' ? 'junction' : 'dir');

    await expect(cleanup()).rejects.toThrow(/parent changed|real directory/u);
    expect(await fs.readFile(path.join(displaced, 'staged.tmp'), 'utf8')).toBe(
      'original staging bytes',
    );
  });

  it('does not follow a replaced parent outside the managed root', async () => {
    const parent = path.join(root, 'runtime');
    const displaced = path.join(root, 'runtime-displaced');
    await fs.mkdir(parent);

    await expect(
      atomicWriteText(path.join(parent, 'state.json'), 'sensitive', {
        containedRoot: root,
        beforeTemporaryOpen: async () => {
          await fs.rename(parent, displaced);
          await fs.symlink(outside, parent, process.platform === 'win32' ? 'junction' : 'dir');
        },
      }),
    ).rejects.toThrow(/managed parent|parent changed/iu);
    const escapedContents = await Promise.all(
      (await fs.readdir(outside)).map((entry) => fs.readFile(path.join(outside, entry), 'utf8')),
    );
    expect(escapedContents).not.toContain('sensitive');
  });
});
