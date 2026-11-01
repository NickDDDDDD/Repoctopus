import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const productionRoots = ['app', 'domains', 'platform', 'services'];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolute = path.join(directory, entry);
    if (statSync(absolute).isDirectory()) return sourceFiles(absolute);
    return /\.(?:ts|tsx|mjs)$/u.test(entry) ? [absolute] : [];
  });
}

describe('Build Strategy and Execution Binding architecture', () => {
  it('has no writable legacy Build Configuration protocol in production source', () => {
    const forbidden = [
      'BuildConfigurationProposal',
      'BuildConfiguration',
      'createBuildConfigurationProposal',
      'acceptBuildConfiguration',
      'build-configuration-candidate',
      'build-configuration-proposed',
      'build-configuration-decision',
      'configurationProposal',
      'repoctopus.build.configuration.id',
    ];
    const findings = productionRoots.flatMap((directory) =>
      sourceFiles(path.join(root, directory)).flatMap((file) => {
        const content = readFileSync(file, 'utf8');
        return forbidden
          .filter((token) => content.includes(token))
          .map((token) => `${path.relative(root, file)}: ${token}`);
      }),
    );
    expect(findings).toEqual([]);
  });
});
