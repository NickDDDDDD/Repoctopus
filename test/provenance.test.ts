import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { checkProvenance } from '../platform/provenance/check.js';

const productRoot = path.resolve(import.meta.dirname, '..');
const temporaryRoots: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function provenanceFixture(development = false): Promise<string> {
  const temporary = await mkdtemp(path.join(tmpdir(), 'repoctopus-provenance-'));
  temporaryRoots.push(temporary);
  const root = path.join(temporary, 'product');
  await mkdir(root);
  await cp(path.join(productRoot, 'third_party'), path.join(root, 'third_party'), {
    recursive: true,
  });
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  await Promise.all(
    [
      'package.json',
      ...(development ? ['package-lock.json', 'scripts/prepare-desktop.mjs'] : []),
    ].map((file) => cp(path.join(productRoot, file), path.join(root, file))),
  );
  const dshPackages = JSON.parse(
    await readFile(path.join(productRoot, 'third_party', 'dsh-adoption.json'), 'utf8'),
  ) as { npmPackages: Array<{ name: string }> };
  const productRequire = createRequire(path.join(productRoot, 'package.json'));
  for (const { name } of dshPackages.npmPackages) {
    const target = path.join(root, 'node_modules', name, 'package.json');
    await mkdir(path.dirname(target), { recursive: true });
    await cp(productRequire.resolve(`${name}/package.json`), target);
  }
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
  it('diagnoses a production install without development resources', async () => {
    const root = await provenanceFixture();
    await expect(readFile(path.join(root, 'package-lock.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(readFile(path.join(root, 'scripts', 'prepare-desktop.mjs'))).rejects.toMatchObject(
      { code: 'ENOENT' },
    );

    expect((await checkProvenance(root)).valid).toBe(true);
  });

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
    const installedPath = path.join(root, 'node_modules/@deepseek-ai/dsh-skill/package.json');
    const installed = JSON.parse(await readFile(installedPath, 'utf8')) as { version: string };
    installed.version = '0.2.1-rc.1';
    await writeFile(installedPath, JSON.stringify(installed, null, 2));

    const result = await checkProvenance(root);
    expect(result.valid).toBe(false);
    expect(result.findings).toContain(
      'Installed DSH package identity mismatch: @deepseek-ai/dsh-skill@0.2.1-rc.5',
    );
  });

  it.each([
    ['missing', 'Installed DSH package unavailable:'],
    ['malformed', 'Installed DSH package unavailable:'],
    ['wrong-name', 'Installed DSH package identity mismatch:'],
  ])('rejects a %s installed production dependency manifest', async (kind, message) => {
    const root = await provenanceFixture();
    const file = path.join(root, 'node_modules/@deepseek-ai/dsh-skill/package.json');
    if (kind === 'missing') await rm(file);
    else if (kind === 'malformed') await writeFile(file, '{broken');
    else await writeFile(file, JSON.stringify({ name: 'another-package', version: '0.2.1-rc.5' }));
    const result = await checkProvenance(root);
    expect(result.valid).toBe(false);
    expect(result.findings).toEqual(
      expect.arrayContaining([expect.stringContaining(`${message} @deepseek-ai/dsh-skill`)]),
    );
  });

  it('rejects a forbidden runtime dependency declaration', async () => {
    const root = await provenanceFixture();
    const file = path.join(root, 'package.json');
    const config = JSON.parse(await readFile(file, 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const adoption = JSON.parse(
      await readFile(path.join(root, 'third_party/dsh-adoption.json'), 'utf8'),
    ) as { forbiddenRuntimePackages: string[] };
    const forbidden = adoption.forbiddenRuntimePackages[0]!;
    config.dependencies[forbidden] = '1.0.0';
    await writeFile(file, JSON.stringify(config));
    const result = await checkProvenance(root);
    expect(result.valid).toBe(false);
    expect(result.findings).toContain(`Forbidden DSH runtime package declared: ${forbidden}`);
  });

  it('does not let NODE_PATH hide a missing ESM production dependency', async () => {
    const root = await provenanceFixture();
    await rm(path.join(root, 'node_modules/@deepseek-ai/dsh-skill/package.json'));
    const entry = pathToFileURL(path.join(productRoot, 'platform/provenance/check.ts')).href;
    const source = `import {checkProvenance} from ${JSON.stringify(entry)};console.log(JSON.stringify(await checkProvenance(process.argv[1])));`;
    const response = await execFileAsync(
      process.execPath,
      ['--experimental-strip-types', '--input-type=module', '-e', source, root],
      {
        cwd: tmpdir(),
        env: { ...process.env, NODE_PATH: path.join(productRoot, 'node_modules') },
      },
    );
    const result = JSON.parse(response.stdout) as { valid: boolean; findings: string[] };
    expect(result.valid).toBe(false);
    expect(result.findings.join('\n')).toContain(
      'Installed DSH package unavailable: @deepseek-ai/dsh-skill',
    );
  });

  it('accepts production dependencies hoisted to the consumer node_modules', async () => {
    const root = await provenanceFixture();
    const consumer = path.dirname(root);
    expect(temporaryRoots).toContain(consumer);
    await mkdir(path.join(consumer, 'node_modules'));
    await rename(
      path.join(root, 'node_modules/@deepseek-ai'),
      path.join(consumer, 'node_modules/@deepseek-ai'),
    );
    expect((await checkProvenance(root)).valid).toBe(true);
  });

  it('rejects modeling Electron lazy binary acquisition as an install script', async () => {
    const root = await provenanceFixture();
    const packagePath = path.join(root, 'package.json');
    const adoption = JSON.parse(
      await readFile(path.join(root, 'third_party', 'dsh-adoption.json'), 'utf8'),
    ) as { desktopBinaryPreparation: { version: string } };
    const electronScriptKey = `electron@${adoption.desktopBinaryPreparation.version}`;
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
      allowScripts?: Record<string, boolean>;
    };
    packageJson.allowScripts = { ...packageJson.allowScripts, [electronScriptKey]: true };
    await writeFile(packagePath, JSON.stringify(packageJson, null, 2));

    const result = await checkProvenance(root);
    expect(result.valid).toBe(false);
    expect(result.findings).toContain(
      `Electron binary acquisition must not be modeled as an install script: ${electronScriptKey}`,
    );
  });

  it('rejects a drift manifest that disagrees with adopted provenance', async () => {
    const root = await provenanceFixture();
    const baselinePath = path.join(root, 'third_party', 'upstream-baselines.json');
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as {
      upstreams: Array<{
        id: string;
        auditedBranchCommit: string;
        pinnedTagCommit: string;
      }>;
    };
    baseline.upstreams.find((entry) => entry.id === 'dsh')!.pinnedTagCommit =
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    await writeFile(baselinePath, JSON.stringify(baseline, null, 2));

    const result = await checkProvenance(root);
    expect(result.valid).toBe(false);
    expect(result.findings).toContain('DSH baseline disagrees with DSH or Cordis provenance');
  });

  it('uses the immutable Comet release commit as the adopted source identity', async () => {
    const root = await provenanceFixture();
    const baselinePath = path.join(root, 'third_party', 'upstream-baselines.json');
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as {
      upstreams: Array<{
        id: string;
        auditedBranchCommit: string;
        pinnedTagCommit: string;
      }>;
    };
    const comet = baseline.upstreams.find((entry) => entry.id === 'comet')!;
    comet.auditedBranchCommit = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    await writeFile(baselinePath, JSON.stringify(baseline, null, 2));

    expect((await checkProvenance(root)).valid).toBe(true);

    comet.pinnedTagCommit = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    await writeFile(baselinePath, JSON.stringify(baseline, null, 2));
    const result = await checkProvenance(root);
    expect(result.valid).toBe(false);
    expect(result.findings).toContain('Comet baseline disagrees with Comet provenance');
  });

  it('rejects the ambiguous upstream baseline schema version 1 contract', async () => {
    const root = await provenanceFixture();
    const baselinePath = path.join(root, 'third_party', 'upstream-baselines.json');
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as { schemaVersion: number };
    baseline.schemaVersion = 1;
    await writeFile(baselinePath, JSON.stringify(baseline, null, 2));

    const result = await checkProvenance(root);
    expect(result.valid).toBe(false);
    expect(result.findings).toContain('Invalid upstream baseline manifest');
  });
});

describe('development source provenance audit', () => {
  it.each(['version', 'integrity', 'preparation-script'])(
    'still rejects development %s drift after runtime diagnostic separation',
    async (kind) => {
      const root = await provenanceFixture(true);
      await mkdir(path.join(root, 'scripts/provenance'), { recursive: true });
      for (const file of ['scripts/check-provenance.mjs', 'scripts/provenance/comet.mjs']) {
        await cp(path.join(productRoot, file), path.join(root, file));
      }
      const run = () =>
        execFileAsync(process.execPath, [path.join(root, 'scripts/check-provenance.mjs')], {
          cwd: root,
        });
      await expect(run()).resolves.toBeDefined();
      if (kind === 'preparation-script') await rm(path.join(root, 'scripts/prepare-desktop.mjs'));
      else {
        const file = path.join(root, 'package-lock.json');
        const lock = JSON.parse(await readFile(file, 'utf8')) as {
          packages: Record<string, Record<string, string>>;
        };
        lock.packages['node_modules/@deepseek-ai/dsh-skill']![kind] = 'invalid';
        await writeFile(file, JSON.stringify(lock));
      }
      await expect(run()).rejects.toThrow(
        kind === 'preparation-script'
          ? /Missing Electron binary preparation command/u
          : /DSH package lock mismatch/u,
      );
    },
  );
});
