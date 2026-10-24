import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { parseSharedProjectConfig } from '../domains/project-configuration/config.js';

async function fixture(): Promise<Record<string, unknown>> {
  return parse(await readFile(path.join(import.meta.dirname, 'fixtures', 'project-config', 'self-hosted-valid.yaml'), 'utf8')) as Record<string, unknown>;
}

describe('project configuration', () => {
  it('keeps the GitHub credential with Delivery publication', async () => {
    const config = parseSharedProjectConfig(await fixture());
    expect(config.delivery?.publication.apiCredential).toEqual({
      provider: 'environment',
      variable: 'REPOCTOPUS_GITHUB_TOKEN',
    });
  });

  it.each(['platformEvents', 'postMerge'])('rejects removed %s configuration with a migration diagnostic', async (field) => {
    const input = await fixture();
    input[field] = {};
    expect(() => parseSharedProjectConfig(input)).toThrow(new RegExp(`${field}.*removed`, 'i'));
  });

  it('rejects raw Delivery credentials', async () => {
    const input = await fixture();
    const publication = (input.delivery as { publication: Record<string, unknown> }).publication;
    publication.apiCredential = 'secret';
    expect(() => parseSharedProjectConfig(input)).toThrow(/publication\.apiCredential/i);
  });
});
