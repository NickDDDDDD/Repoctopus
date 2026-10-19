import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { admitTeamPlugins, importTeamPlugins } from '../app/boot/team-plugins.js';
import { PLUGIN_CONTRACT_VERSION } from '../app/boot/descriptor.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

function digest(source: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(source).digest('hex')}`;
}

describe('team plugin admission', () => {
  it('rejects a digest mismatch before evaluating the plugin module', async () => {
    const workspace = await temporaryDirectory('repoctopus-team-plugin-');
    cleanup.push(workspace);
    const marker = path.join(workspace, 'evaluated.txt');
    const moduleSource = `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'evaluated');\nexport default () => {};\n`;
    const moduleFile = path.join(workspace, 'plugin.mjs');
    const descriptorFile = path.join(workspace, 'plugin.json');
    await writeFile(moduleFile, moduleSource);
    await writeFile(
      descriptorFile,
      JSON.stringify({
        id: 'team-example',
        version: '1.0.0',
        contractVersion: PLUGIN_CONTRACT_VERSION,
        configSchemaVersion: '1',
        configSchema: {
          type: 'object',
          additionalProperties: false,
          properties: { label: { type: 'string' } },
        },
        kind: 'contributor',
        source: 'team',
        codeDigest: `sha256:${'0'.repeat(64)}`,
        compositions: ['project'],
        authorities: [],
        permissions: [],
        stateSchemas: {},
      }),
    );

    await expect(
      admitTeamPlugins(workspace, [
        { id: 'team-example', descriptor: 'plugin.json', module: 'plugin.mjs' },
      ]),
    ).rejects.toThrow(/code digest mismatch/i);
    await expect(readFile(marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    const descriptor = JSON.parse(await readFile(descriptorFile, 'utf8')) as {
      codeDigest: string;
    };
    descriptor.codeDigest = digest(moduleSource);
    await writeFile(descriptorFile, JSON.stringify(descriptor));
    await expect(
      admitTeamPlugins(workspace, [
        {
          id: 'team-example',
          descriptor: 'plugin.json',
          module: 'plugin.mjs',
          config: { unexpected: true },
        },
      ]),
    ).rejects.toThrow(/unexpected is not allowed/i);
    await expect(readFile(marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    const admitted = await admitTeamPlugins(workspace, [
      {
        id: 'team-example',
        descriptor: 'plugin.json',
        module: 'plugin.mjs',
        config: { label: 'accepted' },
      },
    ]);
    const registrations = await importTeamPlugins(admitted);
    expect(registrations[0]?.descriptor.id).toBe('team-example');
    expect(await readFile(marker, 'utf8')).toBe('evaluated');
  });
});
