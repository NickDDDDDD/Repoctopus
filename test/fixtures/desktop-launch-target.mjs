import { writeFile } from 'node:fs/promises';

const output = process.argv[2];
const flag = process.argv.indexOf('--repoctopus-launch-context');
if (!output || flag < 0 || !process.argv[flag + 1]) process.exit(2);

const context = JSON.parse(Buffer.from(process.argv[flag + 1], 'base64url').toString('utf8'));
await writeFile(output, JSON.stringify(context), 'utf8');
