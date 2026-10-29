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
const dshBranchCommit = 'f3803c96974ad4a94195fb97e5c637e9c2a3afe3';
const dshReleaseCommit = '504a01a9578abc2c6f1fb896b1dc322c9fe24f66';
const cometCommit = '35c9860b77b42bafa0c2d80d8d695889f888a924';

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

async function fixture(overrides: Record<string, string> = {}): Promise<NodeJS.ProcessEnv> {
  const root = await mkdtemp(path.join(tmpdir(), 'repoctopus-upstream-drift-'));
  temporaryRoots.push(root);
  const manifest = {
    schemaVersion: 1,
    upstreams: [
      {
        id: 'dsh',
        repository: 'https://invalid.example/dsh.git',
        branch: 'master',
        pinnedCommit: dshBranchCommit,
        pinnedTag: 'dsh-v0.2.1-rc.4',
        pinnedTagCommit: dshReleaseCommit,
      },
      {
        id: 'comet',
        repository: 'https://invalid.example/comet.git',
        branch: 'master',
        pinnedCommit: cometCommit,
        pinnedTag: '0.5.1',
        pinnedTagCommit: cometCommit,
      },
    ],
  };
  const refs = {
    dsh: {
      'refs/heads/master': overrides.dsh ?? dshBranchCommit,
      'refs/tags/dsh-v0.2.1-rc.4': dshReleaseCommit,
    },
    comet: {
      'refs/heads/master': overrides.comet ?? cometCommit,
      'refs/tags/0.5.1': cometCommit,
    },
  };
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
  it('accepts branch and release tags that still resolve to the pinned commits', async () => {
    const { stdout } = await execFileAsync(process.execPath, [script, '--json'], {
      cwd: productRoot,
      env: await fixture(),
    });
    expect(stdout).toContain('"status": "current"');
    expect(stdout.match(/"status": "current"/gu)).toHaveLength(2);
  });

  it('fails when an upstream branch advances beyond the audited baseline', async () => {
    const advanced = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    try {
      await execFileAsync(process.execPath, [script], {
        cwd: productRoot,
        env: await fixture({ dsh: advanced }),
      });
      expect.unreachable('drift check should fail');
    } catch (error: unknown) {
      const failure = error as Error & { code?: number; stdout?: string };
      expect(failure.code).toBe(1);
      expect(failure.stdout).toContain(`dsh: drifted (branch advanced to ${advanced})`);
    }
  });
});
