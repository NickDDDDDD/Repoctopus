import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const productRoot = path.resolve(import.meta.dirname, '..');
const script = path.join(productRoot, 'scripts', 'check-upstream-drift.mjs');
const temporaryRoots: string[] = [];
const dshBranchCommit = '22ddee3792402c3e70ec5f86a63c3e3e895a2f60';
const dshReleaseCommit = '1f81c047fc48fa190a683e469daa699857e9afe8';
const cometCommit = 'aeb1a6598034e28ce46b8422d4dbd8785e607bd7';

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

interface FixtureOverrides {
  dshBranch?: string;
  dshTag?: string;
  mutateManifest?: (manifest: UpstreamBaselineFixture) => void;
}

interface UpstreamBaselineFixture {
  schemaVersion: number;
  upstreams: Array<{
    id: string;
    repository: string;
    branch: string;
    auditedBranchCommit: string;
    pinnedTag: string;
    pinnedTagCommit: string;
  }>;
}

async function fixture(overrides: FixtureOverrides = {}): Promise<NodeJS.ProcessEnv> {
  const root = await mkdtemp(path.join(tmpdir(), 'repoctopus-upstream-drift-'));
  temporaryRoots.push(root);
  const manifest: UpstreamBaselineFixture = {
    schemaVersion: 2,
    upstreams: [
      {
        id: 'dsh',
        repository: 'https://invalid.example/dsh.git',
        branch: 'master',
        auditedBranchCommit: dshBranchCommit,
        pinnedTag: 'dsh-v0.2.1-rc.3',
        pinnedTagCommit: dshReleaseCommit,
      },
      {
        id: 'comet',
        repository: 'https://invalid.example/comet.git',
        branch: 'master',
        auditedBranchCommit: cometCommit,
        pinnedTag: '0.5.0',
        pinnedTagCommit: cometCommit,
      },
    ],
  };
  const refs = {
    dsh: {
      'refs/heads/master': overrides.dshBranch ?? dshBranchCommit,
      'refs/tags/dsh-v0.2.1-rc.3': overrides.dshTag ?? dshReleaseCommit,
    },
    comet: {
      'refs/heads/master': cometCommit,
      'refs/tags/0.5.0': cometCommit,
    },
  };
  overrides.mutateManifest?.(manifest);
  const manifestPath = path.join(root, 'baselines.json');
  const refsPath = path.join(root, 'refs.json');
  await Promise.all([
    writeFile(manifestPath, JSON.stringify(manifest)),
    writeFile(refsPath, JSON.stringify(refs)),
  ]);
  return {
    ...process.env,
    REPOCTOPUS_UPSTREAM_BASELINES: manifestPath,
    REPOCTOPUS_UPSTREAM_REFS_FILE: refsPath,
  };
}

describe('daily upstream drift check', () => {
  it('accepts independently audited branch and immutable release commits', async () => {
    const { stdout } = await execFileAsync(process.execPath, [script, '--json'], {
      cwd: productRoot,
      env: await fixture(),
    });
    expect(stdout).toContain('"status": "current"');
    expect(stdout.match(/"status": "current"/gu)).toHaveLength(2);
    expect(stdout).toContain(`"auditedBranchCommit": "${dshBranchCommit}"`);
    expect(stdout).toContain(`"pinnedTagCommit": "${dshReleaseCommit}"`);
  });

  it('fails when an upstream branch advances beyond the audited baseline', async () => {
    const advanced = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    try {
      await execFileAsync(process.execPath, [script], {
        cwd: productRoot,
        env: await fixture({ dshBranch: advanced }),
      });
      expect.unreachable('drift check should fail');
    } catch (error: unknown) {
      const failure = error as Error & { code?: number; stdout?: string };
      expect(failure.code).toBe(1);
      expect(failure.stdout).toContain(`dsh: drifted (branch advanced to ${advanced})`);
    }
  });

  it('fails when an immutable release tag moves', async () => {
    const moved = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    try {
      await execFileAsync(process.execPath, [script], {
        cwd: productRoot,
        env: await fixture({ dshTag: moved }),
      });
      expect.unreachable('drift check should fail');
    } catch (error: unknown) {
      const failure = error as Error & { code?: number; stdout?: string };
      expect(failure.code).toBe(1);
      expect(failure.stdout).toContain(`dsh: drifted (tag resolves to ${moved})`);
    }
  });

  it('rejects the ambiguous schema version 1 contract', async () => {
    try {
      await execFileAsync(process.execPath, [script], {
        cwd: productRoot,
        env: await fixture({
          mutateManifest: (manifest) => {
            manifest.schemaVersion = 1;
          },
        }),
      });
      expect.unreachable('schema validation should fail');
    } catch (error: unknown) {
      const failure = error as Error & { stderr?: string };
      expect(failure.stderr).toContain('Invalid upstream baseline manifest');
    }
  });

  it('rejects a baseline without an audited branch commit', async () => {
    try {
      await execFileAsync(process.execPath, [script], {
        cwd: productRoot,
        env: await fixture({
          mutateManifest: (manifest) => {
            manifest.upstreams[0]!.auditedBranchCommit = '';
          },
        }),
      });
      expect.unreachable('baseline validation should fail');
    } catch (error: unknown) {
      const failure = error as Error & { stderr?: string };
      expect(failure.stderr).toContain('Invalid upstream baseline: dsh');
    }
  });
});
