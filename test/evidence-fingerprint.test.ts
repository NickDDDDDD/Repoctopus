import { execFile } from 'node:child_process';
import { link, mkdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { createEvidenceFingerprint } from '../domains/evidence/fingerprint.js';
import { compileRepositoryInputPolicy } from '../domains/evidence/repository-input-policy.js';
import {
  collectRepositoryFingerprint,
  RepositoryFingerprintChangedError,
} from '../platform/git/evidence-fingerprint.js';
import { ensureRepoctopusGitignore } from '../platform/project-configuration/gitignore.js';
import {
  createGitRepository,
  removeTemporaryDirectory,
  temporaryDirectory,
} from './helpers/fixtures.js';

const cleanup: string[] = [];
const execFileAsync = promisify(execFile);
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

const hostPolicy = compileRepositoryInputPolicy([
  {
    identity: {
      id: 'codex-host-inputs',
      version: '1.0.0',
    },
    rules: [
      {
        id: 'codex-hooks',
        owner: 'codex-host-inputs',
        path: '.codex/hooks.json',
        match: 'file',
        tracked: 'conflict',
        allowedKinds: ['file'],
      },
      {
        id: 'agent-instructions',
        owner: 'codex-host-inputs',
        path: 'AGENTS.md',
        match: 'file',
        tracked: 'product',
        allowedKinds: ['file'],
      },
    ],
  },
]);

describe('evidence fingerprint', () => {
  it('partitions registered Host inputs without hiding unknown or tracked product inputs', async () => {
    const root = await temporaryDirectory('repoctopus-fingerprint-host-');
    cleanup.push(root);
    const repository = await createGitRepository(root, 'service');
    await mkdir(path.join(repository, '.codex'), { recursive: true });
    await Promise.all([
      writeFile(path.join(repository, '.codex', 'hooks.json'), '{"enabled":true}\n'),
      writeFile(path.join(repository, '.codex', 'unknown.json'), '{}\n'),
      writeFile(path.join(repository, 'AGENTS.md'), '# Local host instructions\n'),
    ]);

    const untracked = await collectRepositoryFingerprint({
      repositoryId: 'service',
      root: repository,
      policy: hostPolicy,
    });
    expect(untracked.dirtyFiles.map((file) => file.path)).toEqual(['.codex/unknown.json']);
    expect(untracked.controlPlane.files.map((file) => file.path)).toEqual([
      '.codex/hooks.json',
      'AGENTS.md',
    ]);

    await execFileAsync('git', ['add', 'AGENTS.md'], { cwd: repository });
    const trackedDualUse = await collectRepositoryFingerprint({
      repositoryId: 'service',
      root: repository,
      policy: hostPolicy,
    });
    expect(trackedDualUse.dirtyFiles.map((file) => file.path)).toEqual([
      '.codex/unknown.json',
      'AGENTS.md',
    ]);
    expect(trackedDualUse.controlPlane.files.map((file) => file.path)).toEqual([
      '.codex/hooks.json',
    ]);

    await execFileAsync('git', ['add', '-f', '.codex/hooks.json'], { cwd: repository });
    await expect(
      collectRepositoryFingerprint({
        repositoryId: 'service',
        root: repository,
        policy: hostPolicy,
      }),
    ).rejects.toThrow(/ownership conflict/u);
  });

  it('captures registered Host inputs even when a local Git ignore hides them', async () => {
    const root = await temporaryDirectory('repoctopus-fingerprint-host-ignore-');
    cleanup.push(root);
    const repository = await createGitRepository(root, 'service');
    await mkdir(path.join(repository, '.codex'), { recursive: true });
    await writeFile(path.join(repository, '.gitignore'), '.codex/\n');
    await execFileAsync('git', ['add', '.gitignore'], { cwd: repository });
    await execFileAsync('git', ['commit', '-m', 'ignore local host'], { cwd: repository });
    await writeFile(path.join(repository, '.codex', 'hooks.json'), '{"enabled":true}\n');

    const fingerprint = await collectRepositoryFingerprint({
      repositoryId: 'service',
      root: repository,
      policy: hostPolicy,
    });
    expect(fingerprint.dirtyFiles).toEqual([]);
    expect(fingerprint.controlPlane.files.map((file) => file.path)).toEqual(['.codex/hooks.json']);
  });

  it('rejects control-plane content that changes during capture', async () => {
    const root = await temporaryDirectory('repoctopus-fingerprint-host-race-');
    cleanup.push(root);
    const repository = await createGitRepository(root, 'service');
    await mkdir(path.join(repository, '.codex'), { recursive: true });
    const hooks = path.join(repository, '.codex', 'hooks.json');
    await writeFile(hooks, '{"revision":1}\n');

    await expect(
      collectRepositoryFingerprint({
        repositoryId: 'service',
        root: repository,
        policy: hostPolicy,
        hooks: { beforeFinalSelection: () => writeFile(hooks, '{"revision":2}\n') },
      }),
    ).rejects.toBeInstanceOf(RepositoryFingerprintChangedError);
  });

  it.each(['added', 'deleted', 'changed-kind'] as const)(
    'rejects a control-plane file that is %s during capture',
    async (mutation) => {
      const root = await temporaryDirectory(`repoctopus-fingerprint-host-${mutation}-`);
      cleanup.push(root);
      const repository = await createGitRepository(root, 'service');
      await mkdir(path.join(repository, '.codex'), { recursive: true });
      const hooks = path.join(repository, '.codex', 'hooks.json');
      if (mutation !== 'added') await writeFile(hooks, '{"revision":1}\n');

      const capture = collectRepositoryFingerprint({
        repositoryId: 'service',
        root: repository,
        policy: hostPolicy,
        hooks: {
          beforeFinalSelection: async () => {
            if (mutation === 'added') await writeFile(hooks, '{"revision":1}\n');
            else if (mutation === 'deleted') await unlink(hooks);
            else {
              await unlink(hooks);
              await mkdir(hooks);
            }
          },
        },
      });
      await expect(capture).rejects.toThrow(/changed|unsafe/u);
    },
  );

  it('rejects unsafe and oversized control-plane inputs', async () => {
    const root = await temporaryDirectory('repoctopus-fingerprint-host-safety-');
    cleanup.push(root);
    const repository = await createGitRepository(root, 'service');
    await mkdir(path.join(repository, '.codex'), { recursive: true });
    await writeFile(
      path.join(repository, '.codex', 'hooks.json'),
      Buffer.alloc(2 * 1024 * 1024 + 1),
    );
    await expect(
      collectRepositoryFingerprint({
        repositoryId: 'service',
        root: repository,
        policy: hostPolicy,
      }),
    ).rejects.toThrow(/file size limit/u);

    const rulesTarget = path.join(root, 'outside-rules');
    await mkdir(rulesTarget);
    await writeFile(path.join(rulesTarget, 'workflow.md'), 'outside');
    await symlink(rulesTarget, path.join(repository, '.codex', 'rules'), 'junction');
    const rulesPolicy = compileRepositoryInputPolicy([
      {
        identity: { id: 'codex-host-inputs', version: '1.0.0' },
        rules: [
          {
            id: 'codex-rules',
            owner: 'codex-host-inputs',
            path: '.codex/rules',
            match: 'tree',
            tracked: 'conflict',
            allowedKinds: ['file'],
          },
        ],
      },
    ]);
    await expect(
      collectRepositoryFingerprint({
        repositoryId: 'service',
        root: repository,
        policy: rulesPolicy,
      }),
    ).rejects.toThrow(/unsafe file/u);
  });

  it('rejects a control-plane file object shared across repository roots', async () => {
    const root = await temporaryDirectory('repoctopus-fingerprint-host-hardlink-');
    cleanup.push(root);
    const repository = await createGitRepository(root, 'service');
    await mkdir(path.join(repository, '.codex'), { recursive: true });
    const outside = path.join(root, 'shared-hooks.json');
    await writeFile(outside, '{"shared":true}\n');
    await link(outside, path.join(repository, '.codex', 'hooks.json'));

    await expect(
      collectRepositoryFingerprint({
        repositoryId: 'service',
        root: repository,
        policy: hostPolicy,
      }),
    ).rejects.toThrow(/unsafe file identity/u);
  });

  it('enforces control-plane manifest file-count and total-size limits', async () => {
    const root = await temporaryDirectory('repoctopus-fingerprint-host-limits-');
    cleanup.push(root);
    const repository = await createGitRepository(root, 'service');
    const rules = path.join(repository, '.codex', 'rules');
    await mkdir(rules, { recursive: true });
    const rulesPolicy = compileRepositoryInputPolicy([
      {
        identity: { id: 'codex-host-inputs', version: '1.0.0' },
        rules: [
          {
            id: 'codex-rules',
            owner: 'codex-host-inputs',
            path: '.codex/rules',
            match: 'tree',
            tracked: 'conflict',
            allowedKinds: ['file'],
          },
        ],
      },
    ]);
    await Promise.all(
      Array.from({ length: 4097 }, (_, index) =>
        writeFile(path.join(rules, `${index.toString().padStart(4, '0')}.md`), ''),
      ),
    );
    await expect(
      collectRepositoryFingerprint({
        repositoryId: 'service',
        root: repository,
        policy: rulesPolicy,
      }),
    ).rejects.toThrow(/file count limit/u);

    await rm(rules, { recursive: true });
    await mkdir(rules);
    const chunk = Buffer.alloc(2 * 1024 * 1024, 1);
    await Promise.all(
      Array.from({ length: 17 }, (_, index) => writeFile(path.join(rules, `${index}.bin`), chunk)),
    );
    await expect(
      collectRepositoryFingerprint({
        repositoryId: 'service',
        root: repository,
        policy: rulesPolicy,
      }),
    ).rejects.toThrow(/total size limit/u);
  });

  it('binds actual dirty and untracked file contents', async () => {
    const root = await temporaryDirectory('repoctopus-fingerprint-');
    cleanup.push(root);
    const repository = await createGitRepository(root, 'service');
    await writeFile(path.join(repository, 'README.md'), '# changed\n');
    await writeFile(path.join(repository, 'new.txt'), 'one');
    const first = await collectRepositoryFingerprint({ repositoryId: 'service', root: repository });
    await writeFile(path.join(repository, 'new.txt'), 'two');
    const second = await collectRepositoryFingerprint({
      repositoryId: 'service',
      root: repository,
    });
    expect(first.head).toBe(second.head);
    expect(first.tree).toBe(second.tree);
    expect(first.dirtyFiles.map((item) => item.path)).toEqual(['README.md', 'new.txt']);
    expect(first.dirtyFiles.find((item) => item.path === 'new.txt')?.sha256).not.toBe(
      second.dirtyFiles.find((item) => item.path === 'new.txt')?.sha256,
    );
  });

  it('changes for every declared non-repository input without storing roots', async () => {
    const root = await temporaryDirectory('repoctopus-fingerprint-inputs-');
    cleanup.push(root);
    const repository = await createGitRepository(root, 'service');
    const repositoryFact = await collectRepositoryFingerprint({
      repositoryId: 'service',
      root: repository,
    });
    const base = {
      schemaVersion: 2 as const,
      profileId: 'verify',
      sharedConfigDigest: 'shared',
      localConfigDigest: 'local',
      repositories: [repositoryFact],
      tools: { node: '24.0.0' },
      adapters: { command: '1' },
      browser: { name: 'chromium', version: '1', revision: '100' },
      journeyDigest: 'journey',
      inputArtifactDigests: ['artifact'],
    };
    const original = createEvidenceFingerprint(base);
    for (const changed of [
      { ...base, sharedConfigDigest: 'changed' },
      { ...base, localConfigDigest: 'changed' },
      { ...base, tools: { node: '25.0.0' } },
      { ...base, adapters: { command: '2' } },
      { ...base, browser: { ...base.browser, revision: '101' } },
      { ...base, journeyDigest: 'changed' },
      { ...base, inputArtifactDigests: ['changed'] },
    ]) {
      expect(createEvidenceFingerprint(changed).digest).not.toBe(original.digest);
    }
    expect(JSON.stringify(original.manifest)).not.toContain(repository);
  });

  it('aggregates multiple repositories deterministically with independent control-plane identity', async () => {
    const root = await temporaryDirectory('repoctopus-fingerprint-multi-');
    cleanup.push(root);
    const firstRoot = await createGitRepository(root, 'first');
    const secondRoot = await createGitRepository(root, 'second');
    for (const repository of [firstRoot, secondRoot]) {
      await mkdir(path.join(repository, '.codex'), { recursive: true });
    }
    await writeFile(path.join(firstRoot, '.codex', 'hooks.json'), '{"repository":"first"}\n');
    await writeFile(path.join(secondRoot, '.codex', 'hooks.json'), '{"repository":"second"}\n');
    const repositories = await Promise.all([
      collectRepositoryFingerprint({ repositoryId: 'first', root: firstRoot, policy: hostPolicy }),
      collectRepositoryFingerprint({
        repositoryId: 'second',
        root: secondRoot,
        policy: hostPolicy,
      }),
    ]);
    const manifest = {
      schemaVersion: 2 as const,
      profileId: 'verify',
      sharedConfigDigest: 'shared',
      localConfigDigest: null,
      repositories,
      tools: {},
      adapters: {},
      inputArtifactDigests: [],
    };
    expect(createEvidenceFingerprint(manifest).digest).toBe(
      createEvidenceFingerprint({ ...manifest, repositories: [...repositories].reverse() }).digest,
    );
    expect(repositories[0].controlPlane.digest).not.toBe(repositories[1].controlPlane.digest);
  });

  it('rejects a repository whose selected content changes during capture', async () => {
    const root = await temporaryDirectory('repoctopus-fingerprint-race-');
    cleanup.push(root);
    const repository = await createGitRepository(root, 'service');
    await writeFile(path.join(repository, 'README.md'), '# first change\n');

    await expect(
      collectRepositoryFingerprint({
        repositoryId: 'service',
        root: repository,
        hooks: {
          beforeFinalSelection: async () => {
            await writeFile(path.join(repository, 'README.md'), '# second change\n');
          },
        },
      }),
    ).rejects.toBeInstanceOf(RepositoryFingerprintChangedError);
  });

  it('excludes personal learning state from the Git-backed Evidence selection', async () => {
    const root = await temporaryDirectory('repoctopus-fingerprint-learning-');
    cleanup.push(root);
    const repository = await createGitRepository(root, 'service');
    await ensureRepoctopusGitignore(repository);
    const learning = path.join(repository, '.repoctopus', 'learning', 'runtime-design');
    await mkdir(learning, { recursive: true });
    await writeFile(path.join(learning, 'notes.md'), 'private learning notes');
    await writeFile(path.join(repository, 'review-me.txt'), 'selected by Evidence');

    const fingerprint = await collectRepositoryFingerprint({
      repositoryId: 'service',
      root: repository,
    });

    expect(fingerprint.dirtyFiles.map((file) => file.path)).toEqual([
      '.gitignore',
      'review-me.txt',
    ]);
    expect(JSON.stringify(fingerprint)).not.toContain('private learning notes');
    expect(JSON.stringify(fingerprint)).not.toContain('.repoctopus/learning');
  });
});
