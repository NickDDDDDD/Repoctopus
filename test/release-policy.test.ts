import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

type FileIdentity = { name: string; size: number; digest: string };
type Release = {
  tagCommit: string | null;
  target: string;
  draft: boolean;
  prerelease: boolean;
  assets: FileIdentity[];
};
type ReleasePolicy = {
  releaseAssetNames(version: string): string[];
  assertReleaseSource(source: {
    commit: string;
    tag: string;
    version: string;
    isMainAncestor: boolean;
    ci: {
      head_sha: string;
      head_branch: string;
      event: string;
      status: string;
      conclusion: string;
    };
    verify: { head_sha: string; name: string; conclusion: string };
  }): void;
  releaseDraftPlan(commit: string, expected: FileIdentity[], release: Release | null): string[];
  assertReadyToPublish(commit: string, expected: FileIdentity[], release: Release | null): void;
  assertReleaseMarker(body: string, expected: string): void;
  describeFile(directory: string, name: string): Promise<FileIdentity>;
  verifyCandidateFiles(directory: string, files: FileIdentity[]): Promise<void>;
};

async function policy(): Promise<ReleasePolicy> {
  const script = new URL('../scripts/release-policy.mjs', import.meta.url).href;
  return (await import(script)) as ReleasePolicy;
}

const commit = 'a'.repeat(40);
const otherCommit = 'b'.repeat(40);
const source = {
  commit,
  tag: 'v0.1.0',
  version: '0.1.0',
  isMainAncestor: true,
  ci: {
    head_sha: commit,
    head_branch: 'main',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
  },
  verify: { head_sha: commit, name: 'verify', conclusion: 'success' },
};
const expected = [
  { name: 'repoctopus-0.1.0.tgz', size: 12, digest: 'sha256:' + 'a'.repeat(64) },
  { name: 'Repoctopus-Desktop-0.1.0-x64-Setup.exe', size: 25, digest: 'sha256:' + 'b'.repeat(64) },
  { name: 'SHA256SUMS', size: 5, digest: 'sha256:' + 'c'.repeat(64) },
];
const draft = {
  tagCommit: null,
  target: commit,
  draft: true,
  prerelease: true,
  assets: expected,
};

describe('release preflight', () => {
  it('uses the source package version for both candidate asset names', async () => {
    const release = await policy();
    expect(release.releaseAssetNames('0.2.3')).toEqual([
      'repoctopus-0.2.3.tgz',
      'Repoctopus-Desktop-0.2.3-x64-Setup.exe',
      'SHA256SUMS',
    ]);
    expect(() => release.releaseAssetNames('../0.2.3')).toThrow(/version/i);
  });

  it('only accepts an exact successful main CI push and matching tag', async () => {
    const release = await policy();
    expect(() => release.assertReleaseSource(source)).not.toThrow();
    expect(() => release.assertReleaseSource({ ...source, isMainAncestor: false })).toThrow(/main/);
    expect(() => release.assertReleaseSource({ ...source, tag: 'v0.2.0' })).toThrow(/tag/i);
    expect(() =>
      release.assertReleaseSource({ ...source, ci: { ...source.ci, event: 'pull_request' } }),
    ).toThrow(/CI/);
    expect(() =>
      release.assertReleaseSource({ ...source, ci: { ...source.ci, head_sha: otherCommit } }),
    ).toThrow(/CI/);
    expect(() =>
      release.assertReleaseSource({
        ...source,
        verify: { ...source.verify, conclusion: 'skipped' },
      }),
    ).toThrow(/verify/);
  });
});

describe('release draft reconciliation', () => {
  it('plans only missing assets for an interrupted matching draft', async () => {
    const release = await policy();
    expect(release.releaseDraftPlan(commit, expected, null)).toEqual(
      expected.map((file) => file.name),
    );
    expect(
      release.releaseDraftPlan(commit, expected, { ...draft, assets: expected.slice(0, 1) }),
    ).toEqual(expected.slice(1).map((file) => file.name));
    expect(release.releaseDraftPlan(commit, expected, draft)).toEqual([]);
  });

  it('rejects a changed tag, changed bytes, duplicate or unexpected asset', async () => {
    const release = await policy();
    expect(() =>
      release.releaseDraftPlan(commit, expected, { ...draft, tagCommit: otherCommit }),
    ).toThrow(/tag/i);
    expect(() => release.releaseDraftPlan(commit, expected, { ...draft, target: 'main' })).toThrow(
      /target/i,
    );
    expect(() =>
      release.releaseDraftPlan(commit, expected, {
        ...draft,
        assets: [{ ...expected[0]!, digest: 'sha256:' + 'd'.repeat(64) }],
      }),
    ).toThrow(/asset/i);
    for (const asset of [expected[0]!, { ...expected[0]!, name: 'unexpected' }]) {
      expect(() =>
        release.releaseDraftPlan(commit, expected, { ...draft, assets: [...expected, asset] }),
      ).toThrow(/asset/i);
    }
  });

  it('requires all bytes before promotion and only reuses matching public prereleases', async () => {
    const release = await policy();
    expect(() => release.assertReadyToPublish(commit, expected, null)).toThrow(/draft/i);
    expect(() =>
      release.assertReadyToPublish(commit, expected, { ...draft, assets: expected.slice(0, 2) }),
    ).toThrow(/missing/i);
    expect(() => release.assertReadyToPublish(commit, expected, draft)).not.toThrow();
    expect(() =>
      release.assertReadyToPublish(commit, expected, { ...draft, draft: false, tagCommit: commit }),
    ).not.toThrow();
    expect(() =>
      release.assertReadyToPublish(commit, expected, { ...draft, draft: false, tagCommit: null }),
    ).toThrow(/tag/i);
    expect(() =>
      release.assertReadyToPublish(commit, expected, {
        ...draft,
        draft: false,
        tagCommit: commit,
        prerelease: false,
      }),
    ).toThrow(/prerelease/i);
  });

  it('binds the draft to the selected artifact and rejects duplicate provenance', async () => {
    const release = await policy();
    const marker = '<!-- repoctopus-release: {"artifact":"42"} -->';
    expect(() => release.assertReleaseMarker('Release notes\n' + marker, marker)).not.toThrow();
    expect(() => release.assertReleaseMarker('Unrelated release', marker)).toThrow(/provenance/);
    expect(() => release.assertReleaseMarker(marker + '\n' + marker, marker)).toThrow(/provenance/);
  });

  it('uses the exact existing tag as the draft target when GitHub omits target metadata', async () => {
    const release = await policy();
    expect(() =>
      release.assertReadyToPublish(commit, expected, {
        ...draft,
        target: 'main',
        tagCommit: commit,
      }),
    ).not.toThrow();
  });
  it('detects corruption of actual candidate bytes including the checksum file', async () => {
    const release = await policy();
    const directory = await mkdtemp(path.join(tmpdir(), 'repoctopus-release-test-'));
    try {
      await writeFile(path.join(directory, 'SHA256SUMS'), 'original');
      const identity = await release.describeFile(directory, 'SHA256SUMS');
      await expect(release.verifyCandidateFiles(directory, [identity])).resolves.toBeUndefined();
      await writeFile(path.join(directory, 'SHA256SUMS'), 'modified');
      await expect(release.verifyCandidateFiles(directory, [identity])).rejects.toThrow(
        /SHA256SUMS/,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
