import { lstat, readdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

import type { DirtyFileFingerprint } from '../../domains/evidence/fingerprint.js';
import {
  matchesEvidenceInputPath,
  validateEvidenceInputPath,
} from '../../domains/evidence/input-policy.js';
import {
  classifyRepositoryInput,
  type CompiledRepositoryInputPolicy,
} from '../../domains/evidence/repository-input-policy.js';
import { runExternalCommandAsync } from '../process/external-command.js';
import { fingerprintFile } from './evidence-fingerprint.js';
import { hashFileRaceSafe } from '../filesystem/race-safe-read.js';

const MAX_FILES = 50_000;
const MAX_BYTES = 512 * 1024 * 1024;

/** Actual content selection, independent of HEAD/index and never silently truncated. */
export async function collectEvidenceInputFiles(input: {
  root: string;
  files?: readonly string[];
  exclude?: readonly string[];
  policy?: CompiledRepositoryInputPolicy;
  hooks?: { beforeFinalSelection?: () => void | Promise<void> };
}): Promise<DirtyFileFingerprint[]> {
  const root = path.resolve(input.root);
  input.files?.forEach(validateEvidenceInputPath);
  input.exclude?.forEach(validateEvidenceInputPath);
  const selected = async (): Promise<string[]> => {
    const [trackedRaw, headRaw, untrackedRaw] = await Promise.all([
      runExternalCommandAsync('git', ['ls-files', '-z'], { cwd: root }),
      runExternalCommandAsync('git', ['ls-tree', '-r', '--name-only', '-z', 'HEAD'], { cwd: root }),
      runExternalCommandAsync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
        cwd: root,
      }),
    ]);
    const split = (raw: string) => raw.split('\0').filter(Boolean);
    const tracked = new Set([...split(trackedRaw), ...split(headRaw)]);
    const candidates = new Set([...tracked, ...split(untrackedRaw)]);
    // Explicit scopes can select ignored files. Visit only each literal prefix;
    // never walk Git internals, directory links, or an unbounded ignored tree.
    const visit = async (relative: string): Promise<void> => {
      validateEvidenceInputPath(relative);
      if (relative.split('/').includes('.git'))
        throw new Error('Git internals are not Evidence inputs');
      if (
        input.policy &&
        classifyRepositoryInput(input.policy, relative, tracked.has(relative)).kind ===
          'runtime-output'
      )
        return;
      if (
        input.exclude?.some(
          (pattern) =>
            matchesEvidenceInputPath(pattern, `${relative}/`) &&
            matchesEvidenceInputPath(pattern, `${relative}/any/deep/file`),
        )
      )
        return;
      const stat = await lstat(path.join(root, relative)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!stat) return;
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        for (const entry of await readdir(path.join(root, relative))) {
          if (entry === '.git') continue;
          await visit(`${relative}/${entry}`);
        }
      } else candidates.add(relative);
      if (candidates.size > MAX_FILES) throw new Error('Evidence input exceeds file count limit');
    };
    for (const pattern of input.files ?? []) {
      const parts = pattern.split('/');
      const firstGlob = parts.findIndex((part) => /[*?]/u.test(part));
      const prefix = (firstGlob === -1 ? parts : parts.slice(0, firstGlob)).join('/');
      if (prefix) await visit(prefix);
      else {
        for (const entry of await readdir(root)) if (entry !== '.git') await visit(entry);
      }
    }
    if (!input.files) {
      for (const entry of await readdir(root)) if (entry !== '.git') await visit(entry);
    }
    const paths = [...candidates]
      .filter((candidate) => {
        validateEvidenceInputPath(candidate);
        if (input.policy) {
          const classification = classifyRepositoryInput(
            input.policy,
            candidate,
            tracked.has(candidate),
          );
          if (classification.kind === 'conflict')
            throw new Error(`Repository input ownership conflict: ${candidate}`);
          if (classification.kind === 'runtime-output') return false;
        }
        return (
          (!input.files ||
            input.files.some((pattern) => matchesEvidenceInputPath(pattern, candidate))) &&
          !input.exclude?.some((pattern) => matchesEvidenceInputPath(pattern, candidate))
        );
      })
      .sort();
    if (paths.length > MAX_FILES) throw new Error('Evidence input exceeds file count limit');
    return paths;
  };
  const capture = async (paths: string[]): Promise<DirtyFileFingerprint[]> => {
    const files: DirtyFileFingerprint[] = [];
    let bytes = 0;
    for (const file of paths) {
      let value = await fingerprintFile(root, file);
      if (value.kind === 'symlink') {
        const resolved = await realpath(path.join(root, file));
        const relative = path.relative(await realpath(root), resolved);
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
          throw new Error('Evidence symlink resolves outside repository');
        const target = await hashFileRaceSafe(resolved, {
          bigint: true,
          label: 'Evidence symlink target',
        });
        if (
          JSON.stringify(value) !== JSON.stringify(await fingerprintFile(root, file)) ||
          (await realpath(path.join(root, file))) !== resolved
        )
          throw new Error('Evidence symlink changed while capturing');
        value = {
          ...value,
          sha256: createHash('sha256').update(`${value.sha256}:${target.digest}`).digest('hex'),
          size: Number(target.stat.size),
        };
      }
      bytes += value.size;
      if (bytes > MAX_BYTES) throw new Error('Evidence input exceeds total size limit');
      // Deleted files are absent effective content, regardless of index history.
      if (value.kind !== 'deleted') files.push(value);
    }
    return files;
  };
  const before = await selected();
  const files = await capture(before);
  await input.hooks?.beforeFinalSelection?.();
  const after = await selected();
  if (
    JSON.stringify(before) !== JSON.stringify(after) ||
    JSON.stringify(files) !== JSON.stringify(await capture(after))
  ) {
    throw new Error('Evidence input content changed while capturing');
  }
  return files;
}
