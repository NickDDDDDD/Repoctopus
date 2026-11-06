import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import path from 'node:path';

export function releaseAssetNames(version) {
  if (
    typeof version !== 'string' ||
    !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(version)
  ) {
    throw new Error('Expected a numeric major.minor.patch package version');
  }
  return [`repoctopus-${version}.tgz`, `Repoctopus-Desktop-${version}-x64-Setup.exe`, 'SHA256SUMS'];
}

export function assertReleaseSource({ commit, tag, version, isMainAncestor, ci, verify }) {
  releaseAssetNames(version);
  if (tag !== `v${version}`) throw new Error('Release tag does not match the package version');
  if (!/^[a-f0-9]{40}$/u.test(commit) || !isMainAncestor) {
    throw new Error('Release commit must be a full SHA in the remote main history');
  }
  if (
    ci?.head_sha !== commit ||
    ci.head_branch !== 'main' ||
    ci.event !== 'push' ||
    ci.status !== 'completed' ||
    ci.conclusion !== 'success'
  ) {
    throw new Error('Expected successful main push CI for the exact release commit');
  }
  if (verify?.head_sha !== commit || verify.name !== 'verify' || verify.conclusion !== 'success') {
    throw new Error('Expected a successful verify job for the exact release commit');
  }
}

export function releaseDraftPlan(commit, expected, release) {
  if (!release) return expected.map(({ name }) => name);
  if (
    (release.tagCommit !== null && release.tagCommit !== commit) ||
    (!release.draft && release.tagCommit !== commit)
  ) {
    throw new Error('Release tag does not resolve to the expected commit');
  }
  if (release.draft && release.tagCommit === null && release.target !== commit) {
    throw new Error('Draft release target does not match the expected commit');
  }
  if (!release.prerelease) throw new Error('Expected a prerelease');

  const missing = new Map(expected.map((file) => [file.name, file]));
  for (const asset of release.assets) {
    const file = missing.get(asset.name);
    if (!file || file.size !== asset.size || file.digest !== asset.digest) {
      throw new Error(`Unexpected or conflicting release asset: ${asset.name}`);
    }
    missing.delete(asset.name);
  }
  if (!release.draft && missing.size > 0) {
    throw new Error('Published release is missing expected assets');
  }
  return [...missing.keys()];
}

export function assertReadyToPublish(commit, expected, release) {
  if (!release) throw new Error('The verified release draft is missing');
  const missing = releaseDraftPlan(commit, expected, release);
  if (missing.length > 0) throw new Error(`Release is missing assets: ${missing.join(', ')}`);
}

export function assertReleaseMarker(body, expected) {
  const markers = (body ?? '')
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('<!-- repoctopus-release:'));
  if (markers.length !== 1 || markers[0] !== expected) {
    throw new Error('Release provenance does not match the selected candidate');
  }
}

export async function describeFile(directory, name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/u.test(name)) {
    throw new Error('Invalid release asset filename');
  }
  const file = path.join(directory, name);
  if (!(await lstat(file)).isFile()) throw new Error(`Expected a regular release file: ${name}`);
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
    size += chunk.length;
  }
  if (size === 0) throw new Error(`Empty release file: ${name}`);
  return { name, size, digest: `sha256:${hash.digest('hex')}` };
}

export async function verifyCandidateFiles(directory, files) {
  for (const file of files) {
    const actual = await describeFile(directory, file.name);
    if (actual.size !== file.size || actual.digest !== file.digest) {
      throw new Error(`Candidate checksum or size mismatch: ${file.name}`);
    }
  }
}
