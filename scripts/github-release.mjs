import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import { promisify } from 'node:util';

import {
  assertReadyToPublish,
  assertReleaseMarker,
  assertReleaseSource,
  describeFile,
  releaseAssetNames,
  releaseDraftPlan,
  verifyCandidateFiles,
} from './release-policy.mjs';

const execute = promisify(execFile);
const repository = 'NickDDDDDD/Repoctopus';
const releaseWorkflow = '.github/workflows/release.yml';
const receiptName = 'release-candidate.json';
const main = 'refs/remotes/origin/main';

function fullSha(value) {
  if (!/^[a-f0-9]{40}$/u.test(value ?? '')) throw new Error('Expected a full commit SHA');
  return value;
}

function numericId(value) {
  if (!/^[1-9]\d*$/u.test(String(value)))
    throw new Error('Expected a positive GitHub ID or attempt');
  return String(value);
}

async function git(...args) {
  return (await execute('git', args)).stdout.trim();
}

async function gh(...args) {
  return (await execute('gh', args, { maxBuffer: 16 * 1024 * 1024 })).stdout;
}

async function api(endpoint) {
  return JSON.parse(await gh('api', `repos/${repository}/${endpoint}`));
}

async function pages(endpoint) {
  return JSON.parse(
    await gh('api', '--paginate', '--slurp', `repos/${repository}/${endpoint}`),
  ).flat();
}

async function output(fields) {
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      Object.entries(fields)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(''),
    );
  }
  process.stdout.write(`${JSON.stringify(fields)}\n`);
}

async function loadSource() {
  const commit = fullSha(process.env.RELEASE_COMMIT);
  const { name, version } = JSON.parse(await git('show', `${commit}:package.json`));
  const tag = process.env.RELEASE_TAG;
  if (name !== 'repoctopus') throw new Error('Expected the Repoctopus package');
  releaseAssetNames(version);
  if (tag !== `v${version}`) throw new Error('Release tag does not match the package version');
  return { commit, tag, version };
}

async function lookupVerify(run) {
  const runId = numericId(run.id);
  const attempt = numericId(run.run_attempt);
  const { jobs } = await api(`actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`);
  return jobs.find(({ name }) => name === 'verify');
}

async function preflight(source) {
  try {
    await git('merge-base', '--is-ancestor', source.commit, main);
  } catch (error) {
    if (error.code !== 1) throw error;
    throw new Error('Release commit is outside the current remote main history', { cause: error });
  }
  const { workflow_runs: runs } = await api(
    `actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${source.commit}&per_page=1`,
  );
  const ci = runs[0];
  if (!ci || ci.conclusion !== 'success') {
    throw new Error('Expected successful main push CI for the exact release commit');
  }
  assertReleaseSource({
    ...source,
    isMainAncestor: true,
    ci,
    verify: await lookupVerify(ci),
  });
  return { ciRun: numericId(ci.id), ciAttempt: numericId(ci.run_attempt) };
}

function workflowDispatch() {
  if (
    process.env.GITHUB_REPOSITORY !== repository ||
    process.env.GITHUB_REF !== 'refs/heads/main' ||
    process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
  ) {
    throw new Error('Release writes require a manual run on the official main branch');
  }
}

async function readTag(tag) {
  const refs = await git(
    'ls-remote',
    '--tags',
    'origin',
    `refs/tags/${tag}`,
    `refs/tags/${tag}^{}`,
  );
  const lines = new Map(
    refs
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha, name] = line.split(/\s+/u);
        return [name, fullSha(sha)];
      }),
  );
  return lines.get(`refs/tags/${tag}^{}`) ?? lines.get(`refs/tags/${tag}`) ?? null;
}

async function readRelease(source) {
  const tagCommit = await readTag(source.tag);
  if (tagCommit !== null && tagCommit !== source.commit) {
    throw new Error('Release tag does not resolve to the expected commit');
  }
  const releases = await pages('releases?per_page=100');
  const matches = releases.filter(({ tag_name }) => tag_name === source.tag);
  if (matches.length > 1) throw new Error('Multiple releases use the requested tag');
  const release = matches[0];
  if (!release) return { tagCommit, release: null };
  const assets = await pages(`releases/${numericId(release.id)}/assets?per_page=100`);
  return {
    tagCommit,
    release: {
      id: numericId(release.id),
      body: release.body,
      tagCommit,
      target: release.target_commitish,
      draft: release.draft,
      prerelease: release.prerelease,
      assets: assets.map(({ name, size, digest, state }) => ({
        name,
        size,
        digest: state === 'uploaded' ? digest : null,
      })),
    },
  };
}

function sums(files) {
  return files.map(({ name, digest }) => `${digest.slice('sha256:'.length)}  ${name}\n`).join('');
}

async function seal(source, directory) {
  if ((await git('rev-parse', 'HEAD')) !== source.commit || (await git('status', '--porcelain'))) {
    throw new Error('Expected a clean candidate checkout at the exact source commit');
  }
  const [cli, desktop, checksums] = releaseAssetNames(source.version);
  const files = await Promise.all([describeFile(directory, cli), describeFile(directory, desktop)]);
  const evidence = JSON.parse(await readFile(process.env.RELEASE_DESKTOP_EVIDENCE, 'utf8'));
  if (
    evidence.kind !== 'WindowsDesktopPackageE2E' ||
    evidence.status !== 'passed' ||
    evidence.candidate?.bytes !== files[1].size ||
    evidence.candidate?.digest !== files[1].digest
  ) {
    throw new Error('Desktop acceptance receipt does not match the candidate EXE');
  }
  if (process.env.RELEASE_CLI_DIGEST !== files[0].digest) {
    throw new Error('CLI tarball changed after verification');
  }
  await writeFile(path.join(directory, checksums), sums(files), { flag: 'wx' });
  files.push(await describeFile(directory, checksums));
  const receipt = {
    ...source,
    schemaVersion: 1,
    run: numericId(process.env.GITHUB_RUN_ID),
    attempt: numericId(process.env.GITHUB_RUN_ATTEMPT),
    ciRun: numericId(process.env.RELEASE_CI_RUN),
    ciAttempt: numericId(process.env.RELEASE_CI_ATTEMPT),
    files,
  };
  await writeFile(path.join(directory, receiptName), `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: 'wx',
  });
}

async function candidateArtifact() {
  const artifact = await api(`actions/artifacts/${numericId(process.env.RELEASE_ARTIFACT_ID)}`);
  const runId = numericId(artifact.workflow_run?.id);
  const run = await api(`actions/runs/${runId}`);
  const artifactAttempt = artifact.name.match(
    new RegExp(`^repoctopus-release-${runId}-([1-9]\\d*)$`, 'u'),
  )?.[1];
  const { jobs } = await api(`actions/runs/${runId}/jobs?per_page=100`);
  if (
    artifact.expired !== false ||
    !artifactAttempt ||
    run.path !== releaseWorkflow ||
    run.head_branch !== 'main' ||
    run.event !== 'workflow_dispatch' ||
    run.conclusion !== 'success' ||
    !jobs.some(({ name, conclusion }) => name === 'Stage release draft' && conclusion === 'success')
  ) {
    throw new Error('Expected an unexpired artifact from a successful main Prepare run');
  }
  return { candidateRun: runId, candidateAttempt: artifactAttempt };
}

async function readCandidate(source, directory) {
  const receipt = JSON.parse(await readFile(path.join(directory, receiptName), 'utf8'));
  const names = releaseAssetNames(source.version);
  const entries = await readdir(directory);
  if (
    entries.length !== names.length + 1 ||
    !entries.includes(receiptName) ||
    !names.every((name) => entries.includes(name)) ||
    receipt.schemaVersion !== 1 ||
    receipt.commit !== source.commit ||
    receipt.tag !== source.tag ||
    receipt.version !== source.version ||
    receipt.run !== numericId(process.env.RELEASE_CANDIDATE_RUN) ||
    receipt.attempt !== numericId(process.env.RELEASE_CANDIDATE_ATTEMPT) ||
    !Array.isArray(receipt.files) ||
    receipt.files.length !== names.length ||
    !names.every((name, index) => receipt.files[index]?.name === name)
  ) {
    throw new Error('Candidate artifact does not match the selected release source');
  }
  await verifyCandidateFiles(directory, receipt.files);
  if (
    (await readFile(path.join(directory, 'SHA256SUMS'), 'utf8')) !== sums(receipt.files.slice(0, 2))
  ) {
    throw new Error('SHA256SUMS does not describe the candidate assets');
  }
  return receipt;
}

function releaseNotes(receipt) {
  const artifact = numericId(process.env.RELEASE_ARTIFACT_ID);
  const ciRun = numericId(receipt.ciRun);
  const ciAttempt = numericId(receipt.ciAttempt);
  const marker = `<!-- repoctopus-release: ${JSON.stringify({
    commit: receipt.commit,
    tag: receipt.tag,
    ciRun,
    ciAttempt,
    run: receipt.run,
    attempt: receipt.attempt,
    artifact,
  })} -->`;
  return {
    marker,
    body: [
      `Source commit: ${receipt.commit}`,
      `CI: https://github.com/${repository}/actions/runs/${ciRun} (attempt ${ciAttempt})`,
      `Prepare: https://github.com/${repository}/actions/runs/${receipt.run} (attempt ${receipt.attempt}, artifact ${artifact})`,
      '',
      marker,
    ].join('\n'),
  };
}

async function uploadAsset(releaseId, directory, asset) {
  const url = new URL(
    `https://uploads.github.com/repos/${repository}/releases/${releaseId}/assets`,
  );
  url.searchParams.set('name', asset.name);
  const response = await globalThis.fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.GH_TOKEN}`,
      'content-type': 'application/octet-stream',
      'content-length': String(asset.size),
    },
    body: createReadStream(path.join(directory, asset.name)),
    duplex: 'half',
    redirect: 'error',
    signal: globalThis.AbortSignal.timeout(180_000),
  });
  if (!response.ok)
    throw new Error(`Release asset upload failed: ${asset.name} (HTTP ${response.status})`);
  const uploaded = await response.json();
  if (uploaded.name !== asset.name || uploaded.state !== 'uploaded') {
    throw new Error(`Unexpected release upload response: ${asset.name}`);
  }
}

async function stage(source, directory) {
  const receipt = await readCandidate(source, directory);
  const notes = releaseNotes(receipt);
  let observed = await readRelease(source);
  if (!observed.release) {
    await gh(
      'release',
      'create',
      source.tag,
      '--repo',
      repository,
      '--draft',
      '--prerelease',
      '--latest=false',
      '--target',
      source.commit,
      '--title',
      `Repoctopus ${source.tag}`,
      '--notes',
      notes.body,
      ...(observed.tagCommit ? ['--verify-tag'] : []),
    );
    observed = await readRelease(source);
    if (!observed.release?.draft) throw new Error('Expected the newly created release draft');
  }
  const { release } = observed;
  assertReleaseMarker(release.body, notes.marker);
  const missing = releaseDraftPlan(source.commit, receipt.files, release);
  for (const asset of receipt.files.filter(({ name }) => missing.includes(name))) {
    await uploadAsset(release.id, directory, asset);
  }
  const staged = (await readRelease(source)).release;
  if (staged?.id !== release.id) throw new Error('Release identity changed during staging');
  assertReleaseMarker(staged.body, notes.marker);
  assertReadyToPublish(source.commit, receipt.files, staged);
  await output({ tag: source.tag, commit: source.commit, candidateRun: receipt.run });
}

async function publish(source, directory) {
  const receipt = await readCandidate(source, directory);
  const candidate = await candidateArtifact();
  if (candidate.candidateRun !== receipt.run || candidate.candidateAttempt !== receipt.attempt) {
    throw new Error('Publish does not match the selected Prepare artifact');
  }
  const ci = await api(
    `actions/runs/${numericId(receipt.ciRun)}/attempts/${numericId(receipt.ciAttempt)}`,
  );
  if (ci.path !== '.github/workflows/ci.yml')
    throw new Error('Candidate CI uses the wrong workflow');
  assertReleaseSource({ ...source, isMainAncestor: true, ci, verify: await lookupVerify(ci) });
  const { release } = await readRelease(source);
  assertReadyToPublish(source.commit, receipt.files, release);
  const { marker } = releaseNotes(receipt);
  assertReleaseMarker(release.body, marker);
  if (release.draft) {
    await gh(
      'api',
      '--method',
      'PATCH',
      `repos/${repository}/releases/${release.id}`,
      '-F',
      'draft=false',
      '-F',
      'prerelease=true',
      '-f',
      'make_latest=false',
      '-f',
      `tag_name=${source.tag}`,
      '-f',
      `target_commitish=${source.commit}`,
    );
  }
  const published = (await readRelease(source)).release;
  if (published?.id !== release.id) throw new Error('Release identity changed during publishing');
  assertReleaseMarker(published.body, marker);
  assertReadyToPublish(source.commit, receipt.files, published);
  if (published.draft) throw new Error('Release did not become public');
}

async function publicAssets(source, directory) {
  const receipt = await readCandidate(source, directory);
  for (const asset of receipt.files) {
    const url = `https://github.com/${repository}/releases/download/${source.tag}/${asset.name}`;
    const response = await globalThis.fetch(url, {
      signal: globalThis.AbortSignal.timeout(180_000),
    });
    if (!response.ok || !response.body)
      throw new Error(`Public download failed: ${asset.name} (${response.status})`);
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of response.body) {
      hash.update(chunk);
      size += chunk.length;
    }
    if (asset.size !== size || asset.digest !== `sha256:${hash.digest('hex')}`) {
      throw new Error(`Public download differs from the candidate: ${asset.name}`);
    }
  }
}

const [operation, folder] = process.argv.slice(2);
const isWrite = operation === 'draft' || operation === 'publish';
if (isWrite) workflowDispatch();
if (isWrite || operation === 'preflight') {
  fullSha(process.env.RELEASE_COMMIT);
  await git('fetch', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main');
}
const source = await loadSource();
if (operation === 'preflight') {
  const ci = await preflight(source);
  const candidate = process.env.RELEASE_ARTIFACT_ID ? await candidateArtifact() : {};
  if (process.env.RELEASE_CHECK_TAG === 'true') await readRelease(source);
  await output({ ...source, ...ci, ...candidate });
} else if (operation === 'names') {
  const [cli, desktop] = releaseAssetNames(source.version);
  await output({ cli, desktop });
} else if (operation === 'cli-digest') {
  const [cli] = releaseAssetNames(source.version);
  await output({ digest: (await describeFile(path.resolve(folder), cli)).digest });
} else {
  const directory = path.resolve(folder);
  if (operation === 'seal') {
    await seal(source, directory);
  } else if (operation === 'draft' || operation === 'publish') {
    await preflight(source);
    if (operation === 'draft') await stage(source, directory);
    else await publish(source, directory);
  } else if (operation === 'public-assets') {
    await publicAssets(source, directory);
  } else {
    throw new Error('Expected a Repoctopus release operation');
  }
}
