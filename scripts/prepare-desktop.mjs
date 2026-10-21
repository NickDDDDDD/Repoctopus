import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const executable = require('electron');

if (typeof executable !== 'string' || !path.isAbsolute(executable)) {
  throw new Error('The pinned Electron package did not resolve an absolute executable path');
}
await access(executable);
process.stdout.write(`Prepared Electron executable: ${executable}\n`);
