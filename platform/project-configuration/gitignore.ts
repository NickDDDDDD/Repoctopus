import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { atomicWriteText } from '../filesystem/atomic-write.js';

const RULE = '.repoctopus/';

export async function ensureRepoctopusGitignore(workspace: string): Promise<string> {
  const root = path.resolve(workspace);
  const file = path.join(root, '.gitignore');
  let source = '';
  try {
    source = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const lines = source.split(/\r?\n/u).map((line) => line.trim());
  if (lines.includes(RULE) || lines.includes('.repoctopus')) return file;
  const prefix = source.length === 0 || source.endsWith('\n') ? source : `${source}\n`;
  await atomicWriteText(
    file,
    `${prefix}# Repoctopus local state, including runs, evidence and personal learning.\n${RULE}\n`,
    { containedRoot: root },
  );
  return file;
}
