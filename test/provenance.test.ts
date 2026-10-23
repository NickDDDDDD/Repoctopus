import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkProvenance } from '../platform/provenance/check.js';

const productRoot = path.resolve(import.meta.dirname, '..');
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function provenanceFixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'repoctopus-provenance-'));
  temporaryRoots.push(root);
  await cp(path.join(productRoot, 'third_party'), path.join(root, 'third_party'), {
    recursive: true,
  });
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  await Promise.all(
    ['package.json', 'package-lock.json', 'scripts/prepare-desktop.mjs'].map((file) =>
      cp(path.join(productRoot, file), path.join(root, file)),
    ),
  );
  const manifest = JSON.parse(
    await readFile(path.join(productRoot, 'third_party', 'comet', 'source-manifest.json'), 'utf8'),
  ) as { files: Array<{ target: string }> };
  for (const entry of manifest.files) {
    const target = path.join(root, entry.target);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(productRoot, entry.target), target);
  }
  const dsh = JSON.parse(
    await readFile(path.join(productRoot, 'third_party', 'dsh-adoption.json'), 'utf8'),
  ) as { components: Array<{ target?: string }> };
  for (const entry of dsh.components.filter(
    (component): component is { target: string } => typeof component.target === 'string',
  )) {
    const target = path.join(root, entry.target);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(productRoot, entry.target), target);
  }
  return root;
}

describe('third-party provenance', () => {
  it('accepts the immutable Cordis snapshot', async () => {
    const result = await checkProvenance(await provenanceFixture());
    expect(result.valid).toBe(true);
    expect(result.fileCount).toBe(113);
  });

  it('rejects a modified Cordis source file', async () => {
    const root = await provenanceFixture();
    const target = path.join(root, 'third_party', 'cordis', 'src', 'context.ts');
    await writeFile(target, `${await readFile(target, 'utf8')}\n// modified in test\n`);

    const result = await checkProvenance(root);
    expect(result.valid).toBe(false);
    expect(result.findings).toContain(
      'Cordis snapshot digest mismatch: third_party/cordis/src/context.ts',
    );
  });

  it('rejects a modified Matt Skill snapshot', async () => {
    const root = await provenanceFixture();
    const target = path.join(
      root,
      'third_party',
      'matt-skills',
      'skills',
      'engineering',
      'tdd',
      'SKILL.md',
    );
    await writeFile(target, `${await readFile(target, 'utf8')}\nmodified in test\n`);

    const result = await checkProvenance(root);
    expect(result.valid).toBe(false);
    expect(result.findings).toContain(
      'Matt Skill snapshot digest mismatch: third_party/matt-skills/skills/engineering/tdd/SKILL.md',
    );
  });

  it('rejects placing a behavior-only Matt reference inside a Provider root', async () => {
    const root = await provenanceFixture();
    const adoptionPath = path.join(root, 'third_party', 'matt-skills', 'method-adoptions.json');
    const adoption = JSON.parse(await readFile(adoptionPath, 'utf8')) as {
      providerRoots: string[];
    };
    adoption.providerRoots.push('third_party/matt-skills/references');
    await writeFile(adoptionPath, JSON.stringify(adoption, null, 2));

    const result = await checkProvenance(root);
    expect(result.valid).toBe(false);
    expect(result.findings).toContain('Matt behavior reference is inside a Provider root: to-spec');
    expect(result.findings).toContain(
      'Matt behavior reference is inside a Provider root: to-tickets',
    );
  });

  it('rejects an adopted Matt rule that is absent from the normalized rule set', async () => {
    const root = await provenanceFixture();
    const adoptionPath = path.join(root, 'third_party', 'matt-skills', 'method-adoptions.json');
    const adoption = JSON.parse(await readFile(adoptionPath, 'utf8')) as {
      references: Array<{ adoptedRuleIds: string[] }>;
    };
    adoption.references[0]!.adoptedRuleIds.push('planning.unregistered-rule');
    await writeFile(adoptionPath, JSON.stringify(adoption, null, 2));

    const result = await checkProvenance(root);
    expect(result.valid).toBe(false);
    expect(result.findings).toContain('Unknown Matt adopted rule: planning.unregistered-rule');
  });

  it('rejects omitting an upstream tracker behavior from the explicit rejection set', async () => {
    const root = await provenanceFixture();
    const adoptionPath = path.join(root, 'third_party', 'matt-skills', 'method-adoptions.json');
    const adoption = JSON.parse(await readFile(adoptionPath, 'utf8')) as {
      references: Array<{ name: string; rejectedBehaviors: string[] }>;
    };
    const toTickets = adoption.references.find((entry) => entry.name === 'to-tickets')!;
    toTickets.rejectedBehaviors = toTickets.rejectedBehaviors.filter(
      (behavior) => behavior !== 'publish-tickets-to-issue-tracker',
    );
    await writeFile(adoptionPath, JSON.stringify(adoption, null, 2));

    const result = await checkProvenance(root);
    expect(result.valid).toBe(false);
    expect(result.findings).toContain(
      'Missing rejected Matt behavior: to-tickets -> publish-tickets-to-issue-tracker',
    );
  });

  it('rejects a Matt TDD snapshot without its codebase-design relationship', async () => {
    const root = await provenanceFixture();
    const adoptionPath = path.join(root, 'third_party', 'matt-skills', 'method-adoptions.json');
    const adoption = JSON.parse(await readFile(adoptionPath, 'utf8')) as {
      relationships: unknown[];
    };
    adoption.relationships = [];
    await writeFile(adoptionPath, JSON.stringify(adoption, null, 2));

    const result = await checkProvenance(root);
    expect(result.valid).toBe(false);
    expect(result.findings).toContain('Missing Matt Skill relationship: tdd -> codebase-design');
  });

  it('rejects a DSH dependency that drifts from the fixed package version', async () => {
    const root = await provenanceFixture();
    const lockPath = path.join(root, 'package-lock.json');
    const lock = JSON.parse(await readFile(lockPath, 'utf8')) as {
      packages: Record<string, { version?: string }>;
    };
    lock.packages['node_modules/@deepseek-ai/dsh-skill']!.version = '0.2.1-rc.1';
    await writeFile(lockPath, JSON.stringify(lock, null, 2));

    const result = await checkProvenance(root);
    expect(result.valid).toBe(false);
    expect(result.findings).toContain(
      'DSH package lock mismatch: @deepseek-ai/dsh-skill@0.2.1-rc.3',
    );
  });

  it('rejects modeling Electron lazy binary acquisition as an install script', async () => {
    const root = await provenanceFixture();
    const packagePath = path.join(root, 'package.json');
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
      allowScripts?: Record<string, boolean>;
    };
    packageJson.allowScripts = { ...packageJson.allowScripts, 'electron@44.7.0': true };
    await writeFile(packagePath, JSON.stringify(packageJson, null, 2));

    const result = await checkProvenance(root);
    expect(result.valid).toBe(false);
    expect(result.findings).toContain(
      'Electron binary acquisition must not be modeled as an install script: electron@44.7.0',
    );
  });

  it('rejects a drift manifest that disagrees with adopted provenance', async () => {
    const root = await provenanceFixture();
    const baselinePath = path.join(root, 'third_party', 'upstream-baselines.json');
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as {
      upstreams: Array<{ id: string; pinnedCommit: string; pinnedTagCommit: string }>;
    };
    baseline.upstreams.find((entry) => entry.id === 'dsh')!.pinnedTagCommit =
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    await writeFile(baselinePath, JSON.stringify(baseline, null, 2));

    const result = await checkProvenance(root);
    expect(result.valid).toBe(false);
    expect(result.findings).toContain('DSH baseline disagrees with DSH or Cordis provenance');
  });
});
