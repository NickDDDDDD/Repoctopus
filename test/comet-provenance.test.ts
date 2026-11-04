import { describe, expect, it } from 'vitest';

import { validateCometProvenance } from '../scripts/provenance/comet.mjs';

const validManifest = {
  schemaVersion: 2,
  upstream: {
    repository: 'https://github.com/rpamis/comet.git',
    commit: '35c9860b77b42bafa0c2d80d8d695889f888a924',
    version: '0.5.1',
    license: 'MIT',
  },
  files: [],
  references: [
    {
      role: 'revision-readiness',
      source: 'domains/comet-classic/classic-sdk-revision-readiness.ts',
      sourceSha256: 'a'.repeat(64),
      adoption: 'behavioral-reference',
    },
    {
      role: 'revision-command',
      source: 'domains/comet-classic/classic-sdk-revision.ts',
      sourceSha256: 'b'.repeat(64),
      adoption: 'behavioral-reference',
    },
    {
      role: 'revision-application',
      source: 'domains/comet-classic/classic-sdk-revision-application.ts',
      sourceSha256: 'c'.repeat(64),
      adoption: 'behavioral-reference',
    },
    {
      role: 'evidence-invalidation',
      source: 'domains/engine/runtime-service.ts',
      sourceSha256: 'd'.repeat(64),
      adoption: 'behavioral-reference',
    },
  ],
};

describe('Comet provenance contract', () => {
  it('accepts fixed behavioral references without a runtime dependency', () => {
    expect(
      validateCometProvenance(validManifest, {
        dependencies: { yaml: '2.9.1' },
        optionalDependencies: {},
        peerDependencies: {},
      }),
    ).toEqual([]);
  });

  it('rejects an incomplete reference set and a packaged Comet dependency', () => {
    const manifest = {
      ...validManifest,
      references: validManifest.references.slice(0, 3),
    };

    expect(
      validateCometProvenance(
        manifest,
        { dependencies: { engine: 'npm:@rpamis/comet@0.5.1' } },
        {
          packages: {
            'node_modules/engine': { name: '@rpamis/comet', version: '0.5.1' },
          },
        },
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/evidence-invalidation/iu),
        expect.stringMatching(/runtime dependency/iu),
      ]),
    );
  });

  it('binds every role to its exact upstream source and release identity', () => {
    const swappedReferences = validManifest.references.map((reference, index, all) => ({
      ...reference,
      source: all[(index + 1) % all.length]!.source,
    }));

    expect(
      validateCometProvenance(
        {
          ...validManifest,
          upstream: {
            ...validManifest.upstream,
            repository: 'https://example.com/comet.git',
            version: 'main',
          },
          references: swappedReferences,
        },
        { dependencies: {} },
        { packages: {} },
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/repository/iu),
        expect.stringMatching(/version/iu),
        expect.stringMatching(/source/iu),
      ]),
    );
  });

  it('rejects an unlicensed or unpinned upstream identity', () => {
    expect(
      validateCometProvenance(
        {
          ...validManifest,
          upstream: { ...validManifest.upstream, commit: 'main', license: 'unknown' },
        },
        { dependencies: {} },
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/commit/iu),
        expect.stringMatching(/license/iu),
      ]),
    );
  });
});
