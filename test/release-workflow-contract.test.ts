import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

async function read(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, import.meta.url), 'utf8');
}

type Job = {
  if: string;
  permissions: Record<string, string>;
  needs?: string[];
  steps: Array<{
    uses?: string;
    run?: string;
    env?: Record<string, string>;
    with?: Record<string, unknown>;
  }>;
};
type Workflow = { on: Record<string, unknown>; permissions: object; jobs: Record<string, Job> };

describe('GitHub release workflow contract', () => {
  it('only runs manually and restricts write permissions to release jobs', async () => {
    const workflow = parse(await read('../.github/workflows/release.yml')) as Workflow;
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
    expect(workflow.permissions).toEqual({});
    const writers = Object.entries(workflow.jobs).filter(
      ([, job]) => job.permissions.contents === 'write',
    );
    expect(writers.map(([name]) => name)).toEqual(['draft', 'publish']);
    for (const [, job] of writers) {
      expect(job.needs).toContain('preflight');
      expect(job.permissions.actions).toBe('read');
      expect(job.steps.some(({ run }) => run?.includes('scripts/github-release.mjs'))).toBe(true);
    }
    expect(workflow.jobs.preflight?.if).toContain("github.ref == 'refs/heads/main'");
    expect(workflow.jobs.preflight?.if).toContain("github.repository == 'NickDDDDDD/Repoctopus'");
    expect(workflow.jobs.candidate?.permissions.contents).toBe('read');
    for (const job of [workflow.jobs.draft, workflow.jobs.publish, workflow.jobs['public-smoke']]) {
      const download = job?.steps.find(({ uses }) =>
        uses?.startsWith('actions/download-artifact@'),
      );
      expect(download?.with?.['merge-multiple']).toBe(true);
    }
    expect(
      workflow.jobs.candidate?.steps.some(({ run }) => run?.includes('test:desktop-package-e2e')),
    ).toBe(true);
  });

  it('reuses the existing package checks for the versioned release candidates', async () => {
    const consumer = await read('./e2e/package.e2e.test.ts');
    expect(consumer).toContain('REPOCTOPUS_PACKAGE_CANDIDATE');
    for (const script of ['check-desktop-package.mjs', 'windows-desktop-package-e2e.mjs']) {
      const source = await read('../scripts/' + script);
      expect(source).toContain('releaseAssetNames');
      expect(source).not.toContain('Repoctopus-Desktop-0.1.0-x64-Setup.exe');
    }
  });
});
