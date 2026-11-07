import { createHash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { lstat, readdir, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';

import type {
  ControlPlaneFileFingerprint,
  DirtyFileFingerprint,
  RepositoryFingerprint,
} from '../../domains/evidence/fingerprint.js';
import {
  classifyRepositoryInput,
  EMPTY_REPOSITORY_INPUT_POLICY,
  type CompiledRepositoryInputPolicy,
  type RepositoryInputPolicyRule,
} from '../../domains/evidence/repository-input-policy.js';
import { canonicalJson } from '../../domains/workflow-contract/canonical.js';
import { sameFileObject } from '../filesystem/file-identity.js';
import { hashFileRaceSafe } from '../filesystem/race-safe-read.js';
import { runExternalCommandAsync } from '../process/external-command.js';

const MAX_CONTROL_PLANE_FILES = 4096;
const MAX_CONTROL_PLANE_FILE_BYTES = 4 * 1024 * 1024;
const MAX_CONTROL_PLANE_TOTAL_BYTES = 32 * 1024 * 1024;

export class RepositoryFingerprintChangedError extends Error {
  constructor(readonly repositoryId: string) {
    super(`Repository inputs changed while fingerprinting: ${repositoryId}`);
    this.name = 'RepositoryFingerprintChangedError';
  }
}

interface GitSelection {
  head: string;
  tree: string;
  policyDigest: `sha256:${string}`;
  dirtyPaths: string[];
  controlPlanePaths: string[];
}

function nulPaths(value: string): string[] {
  return value
    .split('\0')
    .filter(Boolean)
    .map((item) => item.replaceAll('\\', '/'));
}

function containedPath(root: string, relativePath: string): string {
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Git reported a path outside its repository: ${relativePath}`);
  }
  return target;
}

function inside(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

function sameFileSnapshot(left: BigIntStats, right: BigIntStats): boolean {
  return (
    sameFileObject(
      { dev: left.dev, ino: left.ino, birthtime: left.birthtimeNs },
      { dev: right.dev, ino: right.ino, birthtime: right.birthtimeNs },
    ) &&
    left.size === right.size &&
    left.ctimeNs === right.ctimeNs &&
    left.mtimeNs === right.mtimeNs
  );
}

export async function fingerprintFile(
  root: string,
  relativePath: string,
): Promise<DirtyFileFingerprint> {
  const normalized = relativePath.replaceAll('\\', '/');
  const target = containedPath(root, normalized);
  try {
    const information = await lstat(target, { bigint: true });
    if (information.isSymbolicLink()) {
      const link = await readlink(target, 'utf8');
      const after = await lstat(target, { bigint: true });
      if (!after.isSymbolicLink() || !sameFileSnapshot(information, after)) {
        throw new Error(`Dirty symlink changed while fingerprinting: ${normalized}`);
      }
      return {
        path: normalized,
        kind: 'symlink',
        sha256: createHash('sha256').update(link).digest('hex'),
        size: Buffer.byteLength(link),
      };
    }
    if (!information.isFile()) throw new Error(`Dirty input is not a regular file: ${normalized}`);
    const captured = await hashFileRaceSafe(target, {
      bigint: true,
      label: `dirty input ${normalized}`,
    });
    if (!inside(await realpath(root), captured.realPath)) {
      throw new Error(`Dirty input resolves outside its repository: ${normalized}`);
    }
    return {
      path: normalized,
      kind: 'file',
      sha256: captured.digest,
      size: Number(captured.stat.size),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return {
      path: normalized,
      kind: 'deleted',
      sha256: createHash('sha256').update('deleted').digest('hex'),
      size: 0,
    };
  }
}

async function filesForRule(root: string, rule: RepositoryInputPolicyRule): Promise<string[]> {
  const start = containedPath(root, rule.path);
  const information = await lstat(start).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (information === null) return [];
  if (rule.match === 'file' || !information.isDirectory()) return [rule.path];

  const files: string[] = [];
  const visit = async (relative: string): Promise<void> => {
    const entries = await readdir(containedPath(root, relative), { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory() && !entry.isSymbolicLink()) await visit(child);
      else files.push(child);
      if (files.length > MAX_CONTROL_PLANE_FILES) {
        throw new Error('Control-plane input exceeds the file count limit');
      }
    }
  };
  await visit(rule.path);
  return files;
}

async function captureSelection(
  root: string,
  policy: CompiledRepositoryInputPolicy,
): Promise<GitSelection> {
  const [head, tree, changed, untracked, indexPaths, headPaths, explicitCandidates] =
    await Promise.all([
      runExternalCommandAsync('git', ['rev-parse', 'HEAD'], { cwd: root }),
      runExternalCommandAsync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root }),
      runExternalCommandAsync('git', ['diff', '--name-only', '-z', 'HEAD', '--'], { cwd: root }),
      runExternalCommandAsync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
        cwd: root,
      }),
      runExternalCommandAsync('git', ['ls-files', '-z'], { cwd: root }),
      runExternalCommandAsync('git', ['ls-tree', '-r', '--name-only', '-z', 'HEAD'], { cwd: root }),
      Promise.all(
        policy.rules
          .filter((rule) => rule.untracked !== 'runtime-output')
          .map((rule) => filesForRule(root, rule)),
      ),
    ]);
  const trackedPaths = [...nulPaths(indexPaths), ...nulPaths(headPaths)];
  const tracked = new Set(trackedPaths.map((item) => item.toLocaleLowerCase('en-US')));
  for (const trackedPath of trackedPaths) {
    const classification = classifyRepositoryInput(policy, trackedPath, true);
    if (classification.kind === 'conflict') {
      throw new Error(
        `Repository input ownership conflict: ${trackedPath} (${classification.ruleId})`,
      );
    }
  }

  const dirtyPaths: string[] = [];
  const controlPlanePaths = new Set<string>();
  for (const candidate of [...new Set([...nulPaths(changed), ...nulPaths(untracked)])]) {
    const isTracked = tracked.has(candidate.toLocaleLowerCase('en-US'));
    const classification = classifyRepositoryInput(policy, candidate, isTracked);
    if (classification.kind === 'conflict') {
      throw new Error(
        `Repository input ownership conflict: ${candidate} (${classification.ruleId})`,
      );
    }
    if (classification.kind === 'control-plane') controlPlanePaths.add(candidate);
    else if (classification.kind !== 'runtime-output') dirtyPaths.push(candidate);
  }
  for (const candidate of explicitCandidates.flat()) {
    const isTracked = tracked.has(candidate.toLocaleLowerCase('en-US'));
    const classification = classifyRepositoryInput(policy, candidate, isTracked);
    if (classification.kind === 'conflict') {
      throw new Error(
        `Repository input ownership conflict: ${candidate} (${classification.ruleId})`,
      );
    }
    if (classification.kind === 'control-plane') controlPlanePaths.add(candidate);
  }
  if (controlPlanePaths.size > MAX_CONTROL_PLANE_FILES) {
    throw new Error('Control-plane input exceeds the file count limit');
  }
  return {
    head: head.trim(),
    tree: tree.trim(),
    policyDigest: policy.digest,
    dirtyPaths: [...new Set(dirtyPaths)].sort(),
    controlPlanePaths: [...controlPlanePaths].sort(),
  };
}

function sameSelection(left: GitSelection, right: GitSelection): boolean {
  return (
    left.head === right.head &&
    left.tree === right.tree &&
    left.policyDigest === right.policyDigest &&
    JSON.stringify(left.dirtyPaths) === JSON.stringify(right.dirtyPaths) &&
    JSON.stringify(left.controlPlanePaths) === JSON.stringify(right.controlPlanePaths)
  );
}

async function fingerprintControlPlaneFile(
  root: string,
  relativePath: string,
  policy: CompiledRepositoryInputPolicy,
): Promise<ControlPlaneFileFingerprint> {
  const classification = classifyRepositoryInput(policy, relativePath, false);
  if (classification.kind !== 'control-plane') {
    throw new Error(`Control-plane input is not owned by the current policy: ${relativePath}`);
  }
  const rule = policy.rules.find((candidate) => candidate.id === classification.ruleId)!;
  const target = containedPath(root, relativePath);
  const before = await lstat(target, { bigint: true });
  if (!before.isFile() || before.nlink !== 1n) {
    throw new Error(`Control-plane input has an unsafe file identity: ${relativePath}`);
  }
  const fingerprint = await fingerprintFile(root, relativePath);
  const after = await lstat(target, { bigint: true });
  if (!after.isFile() || after.nlink !== 1n || !sameFileSnapshot(before, after)) {
    throw new Error(`Control-plane input changed file identity: ${relativePath}`);
  }
  if (fingerprint.kind !== 'file' || !rule.allowedKinds.includes(fingerprint.kind)) {
    throw new Error(`Control-plane input has an unsafe file type: ${relativePath}`);
  }
  if (fingerprint.size > MAX_CONTROL_PLANE_FILE_BYTES) {
    throw new Error(`Control-plane input exceeds the file size limit: ${relativePath}`);
  }
  return {
    ...fingerprint,
    kind: 'file',
    owner: classification.owner,
    ruleId: classification.ruleId,
  };
}

function controlPlaneDigest(
  policyDigest: `sha256:${string}`,
  files: readonly ControlPlaneFileFingerprint[],
): `sha256:${string}` {
  return `sha256:${createHash('sha256')
    .update(canonicalJson({ schemaVersion: 1, policyDigest, files }))
    .digest('hex')}`;
}

export async function collectRepositoryFingerprint(input: {
  repositoryId: string;
  root: string;
  policy?: CompiledRepositoryInputPolicy;
  hooks?: { beforeFinalSelection?: () => void | Promise<void> };
}): Promise<RepositoryFingerprint> {
  const root = path.resolve(input.root);
  const policy = input.policy ?? EMPTY_REPOSITORY_INPUT_POLICY;
  const before = await captureSelection(root, policy);
  const [dirtyFiles, controlPlaneFiles] = await Promise.all([
    Promise.all(before.dirtyPaths.map((file) => fingerprintFile(root, file))),
    Promise.all(
      before.controlPlanePaths.map((file) => fingerprintControlPlaneFile(root, file, policy)),
    ),
  ]);
  if (
    controlPlaneFiles.reduce((total, file) => total + file.size, 0) > MAX_CONTROL_PLANE_TOTAL_BYTES
  ) {
    throw new Error('Control-plane input exceeds the total size limit');
  }
  await input.hooks?.beforeFinalSelection?.();
  const after = await captureSelection(root, policy);
  if (!sameSelection(before, after)) {
    throw new RepositoryFingerprintChangedError(input.repositoryId);
  }
  const [confirmedDirty, confirmedControlPlane] = await Promise.all([
    Promise.all(after.dirtyPaths.map((file) => fingerprintFile(root, file))),
    Promise.all(
      after.controlPlanePaths.map((file) => fingerprintControlPlaneFile(root, file, policy)),
    ),
  ]);
  if (
    JSON.stringify(dirtyFiles) !== JSON.stringify(confirmedDirty) ||
    JSON.stringify(controlPlaneFiles) !== JSON.stringify(confirmedControlPlane)
  ) {
    throw new RepositoryFingerprintChangedError(input.repositoryId);
  }
  return {
    repositoryId: input.repositoryId,
    head: before.head,
    tree: before.tree,
    dirtyFiles,
    inputPolicyDigest: policy.digest,
    controlPlane: {
      digest: controlPlaneDigest(policy.digest, controlPlaneFiles),
      files: controlPlaneFiles,
    },
  };
}
