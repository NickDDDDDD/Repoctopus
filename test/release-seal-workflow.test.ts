import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('release seal workflow evidence', () => {
  it.each(['passed', 'missing', 'mismatched'])(
    'checks %s workflow evidence before sealing',
    async (mode) => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'rp-seal-'));
      const repository = path.join(root, 'repository');
      const assets = path.join(root, 'assets');
      const environment = {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: path.join(root, 'gitconfig'),
      };
      await mkdir(repository);
      await mkdir(assets);
      try {
        const git = (...args: string[]) =>
          execFileSync('git', args, {
            cwd: repository,
            env: environment,
            encoding: 'utf8',
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
          }).trim();
        git('init', '--initial-branch=main');
        git('config', 'user.name', 'Release Fixture');
        git('config', 'user.email', 'release@example.invalid');
        await writeFile(
          path.join(repository, 'package.json'),
          '{"name":"repoctopus","version":"0.1.0"}',
        );
        git('add', '--', 'package.json');
        git('commit', '--no-gpg-sign', '-m', 'test: seal fixture');
        const cli = Buffer.from('isolated CLI identity fixture');
        const desktop = Buffer.from('isolated desktop identity fixture');
        const digest = (value: Buffer) =>
          'sha256:' + createHash('sha256').update(value).digest('hex');
        await writeFile(path.join(assets, 'repoctopus-0.1.0.tgz'), cli);
        await writeFile(path.join(assets, 'Repoctopus-Desktop-0.1.0-x64-Setup.exe'), desktop);
        const desktopEvidence = path.join(root, 'desktop.json');
        const workflowEvidence = path.join(root, 'workflow.json');
        await writeFile(
          desktopEvidence,
          JSON.stringify({
            kind: 'WindowsDesktopPackageE2E',
            status: 'passed',
            candidate: { bytes: desktop.length, digest: digest(desktop) },
          }),
        );
        if (mode !== 'missing') {
          await writeFile(
            workflowEvidence,
            JSON.stringify({
              kind: 'WindowsMultirepoPackageE2E',
              status: 'passed',
              candidate: {
                size: cli.length,
                digest: mode === 'mismatched' ? digest(desktop) : digest(cli),
              },
              runId: 'fixture-run',
              finalStatus: 'completed',
              checks: [
                'init-to-archive',
                'build-cold-recovery',
                'publication-response-loss',
                'terminal-recovery',
              ].map((id) => ({ id, status: 'passed' })),
            }),
          );
        }
        const result = spawnSync(
          process.execPath,
          [
            fileURLToPath(new URL('../scripts/github-release.mjs', import.meta.url)),
            'seal',
            assets,
          ],
          {
            cwd: repository,
            encoding: 'utf8',
            windowsHide: true,
            timeout: 20_000,
            env: {
              ...environment,
              RELEASE_COMMIT: git('rev-parse', 'HEAD'),
              RELEASE_TAG: 'v0.1.0',
              RELEASE_DESKTOP_EVIDENCE: desktopEvidence,
              RELEASE_WORKFLOW_EVIDENCE: workflowEvidence,
              RELEASE_CLI_DIGEST: digest(cli),
              GITHUB_RUN_ID: '1',
              GITHUB_RUN_ATTEMPT: '1',
              RELEASE_CI_RUN: '2',
              RELEASE_CI_ATTEMPT: '1',
            },
          },
        );
        if (mode === 'passed') {
          expect(result.status, result.stderr).toBe(0);
          expect(await readFile(path.join(assets, 'SHA256SUMS'), 'utf8')).toContain(
            digest(cli).slice(7),
          );
          expect(
            JSON.parse(await readFile(path.join(assets, 'release-candidate.json'), 'utf8')),
          ).toMatchObject({ version: '0.1.0' });
        } else {
          expect(result.status).toBe(1);
          await expect(readFile(path.join(assets, 'SHA256SUMS'))).rejects.toThrow();
          await expect(readFile(path.join(assets, 'release-candidate.json'))).rejects.toThrow();
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
