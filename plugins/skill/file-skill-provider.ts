import { access, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import type { Context } from '@deepseek-ai/cordis';
import type {
  SkillCandidate,
  SkillDefinition,
  SkillInvocationPolicy,
  SkillLookupOptions,
  SkillProvider,
  SkillProviderControl,
  SkillProviderObservation,
  SkillSource,
} from '@deepseek-ai/dsh-skill';
import chokidar, { type FSWatcher } from 'chokidar';
import { parse } from 'yaml';

import { isOwnedWorkspaceEntrySkill } from '../../domains/project-configuration/entry-skills.js';

export interface SkillDirectoryRoot {
  readonly path: string;
  readonly rank: number;
  readonly source: SkillSource;
  readonly skipSystem?: boolean;
}

export interface FileSkillProviderOptions {
  readonly name: string;
  readonly roots: readonly SkillDirectoryRoot[];
  readonly watch?: boolean;
  readonly transform?: (definition: SkillDefinition) => SkillDefinition;
}

interface FileLocator {
  readonly file: string;
  readonly directory?: string;
}

interface ParsedSkill {
  readonly name: string;
  readonly description: string;
  readonly whenToUse?: string;
  readonly invocation: SkillInvocationPolicy;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly content: string;
  readonly file: string;
}

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Node-filesystem adaptation of DSH's file provider.
 *
 * It intentionally retains DSH's provider contract, rank semantics, lazy body
 * loading, incomplete observation, cancellation and invalidation behavior. It
 * removes DSH Home and ctx.fs because Repoctopus receives explicit roots from
 * its project composition.
 */
export class FileSkillProvider implements SkillProvider {
  readonly name: string;
  private readonly roots: readonly SkillDirectoryRoot[];
  private readonly transform: ((definition: SkillDefinition) => SkillDefinition) | undefined;
  private watcher?: FSWatcher;
  private watcherReady?: Promise<void>;
  private watcherErrorListener?: (error: unknown) => void;
  private disposed = false;

  constructor(
    private readonly context: Context,
    private readonly control: SkillProviderControl,
    options: FileSkillProviderOptions,
  ) {
    this.name = options.name;
    this.roots = options.roots.map((root) => ({ ...root, path: path.resolve(root.path) }));
    this.transform = options.transform;
    if (options.watch !== false) this.startWatcher();
    control.signal.addEventListener('abort', () => void this.dispose(), { once: true });
  }

  async list(options: SkillLookupOptions): Promise<SkillCandidate[] | SkillProviderObservation> {
    options.signal?.throwIfAborted();
    let complete = true;
    if (this.watcherReady) {
      try {
        await raceAbort(this.watcherReady, options.signal);
      } catch (error) {
        options.signal?.throwIfAborted();
        complete = false;
        this.context.logger.warn(
          `skill provider "${this.name}" watcher is incomplete: ${String(error)}`,
        );
      }
    }

    const candidates: SkillCandidate[] = [];
    for (const root of this.roots) {
      for (const candidate of await this.discoverRoot(root, options.signal)) {
        candidates.push(candidate);
      }
    }
    return complete ? candidates : { candidates, complete };
  }

  async get(
    candidate: SkillCandidate,
    options: SkillLookupOptions,
  ): Promise<SkillDefinition | undefined> {
    const locator = candidate.locator as FileLocator;
    const parsed = await parseSkillFile(locator.file, options.signal);
    if (!parsed) return undefined;
    const definition: SkillDefinition = {
      name: parsed.name,
      description: parsed.description,
      ...(parsed.whenToUse ? { whenToUse: parsed.whenToUse } : {}),
      invocation: parsed.invocation,
      source: candidate.source,
      provider: this.name,
      ...(locator.directory
        ? { resourceBase: { kind: 'directory', path: locator.directory } }
        : {}),
      path: parsed.file,
      ...(parsed.metadata ? { metadata: parsed.metadata } : {}),
      content: parsed.content,
    };
    return this.transform?.(definition) ?? definition;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (!this.watcher) return;
    const closing = this.watcher.close();
    // Chokidar removes listeners during close(), but an already scheduled
    // awaitWriteFinish poll can still emit a late Windows filesystem error.
    // Keep an error sink attached until that closing work has settled.
    if (this.watcherErrorListener) {
      this.watcher.on('error', this.watcherErrorListener);
    }
    await closing;
  }

  private startWatcher(): void {
    const watcher = chokidar.watch(
      this.roots.map((root) => root.path),
      { ignoreInitial: true },
    );
    this.watcher = watcher;
    let ready = false;
    this.watcherReady = new Promise<void>((resolve, reject) => {
      watcher.once('ready', () => {
        ready = true;
        resolve();
      });
      this.watcherErrorListener = (error) => {
        if (!ready) {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        if (this.disposed || this.control.signal.aborted) return;
        this.context.logger.warn(`skill provider "${this.name}" watcher failed: ${String(error)}`);
        this.control.invalidate();
      };
      watcher.on('error', this.watcherErrorListener);
    });
    watcher.on('all', () => {
      if (!this.disposed && !this.control.signal.aborted) this.control.invalidate();
    });
  }

  private async discoverRoot(
    root: SkillDirectoryRoot,
    signal?: AbortSignal,
  ): Promise<SkillCandidate[]> {
    signal?.throwIfAborted();
    let entries;
    try {
      entries = await readdir(root.path, { withFileTypes: true });
    } catch (error) {
      if (hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR')) return [];
      throw error;
    }
    const candidates: SkillCandidate[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      signal?.throwIfAborted();
      if (root.skipSystem && entry.name === '.system') continue;
      const file = entry.isDirectory()
        ? path.join(root.path, entry.name, 'SKILL.md')
        : entry.isFile() && entry.name.endsWith('.md')
          ? path.join(root.path, entry.name)
          : undefined;
      if (!file) continue;
      if (entry.isDirectory() && (await isManagedProjection(path.dirname(file)))) continue;
      const parsed = await parseSkillFile(file, signal);
      if (!parsed) continue;
      const directory = entry.isDirectory() ? path.dirname(file) : undefined;
      candidates.push({
        name: parsed.name,
        description: parsed.description,
        ...(parsed.whenToUse ? { whenToUse: parsed.whenToUse } : {}),
        invocation: parsed.invocation,
        source: root.source,
        provider: this.name,
        rank: root.rank,
        locator: { file, ...(directory ? { directory } : {}) } satisfies FileLocator,
        ...(directory ? { resourceBase: { kind: 'directory', path: directory } } : {}),
        path: parsed.file,
        ...(parsed.metadata ? { metadata: parsed.metadata } : {}),
      });
    }
    return candidates;
  }
}

async function parseSkillFile(
  file: string,
  signal?: AbortSignal,
): Promise<ParsedSkill | undefined> {
  signal?.throwIfAborted();
  let resolved: string;
  let raw: string;
  try {
    resolved = await realpath(file);
    raw = await readFile(resolved, { encoding: 'utf8', signal });
  } catch (error) {
    signal?.throwIfAborted();
    if (hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR')) return undefined;
    throw error;
  }
  if (
    path.basename(file) === 'SKILL.md' &&
    path.basename(path.dirname(file)) === 'repoctopus' &&
    isOwnedWorkspaceEntrySkill(raw)
  ) {
    return undefined;
  }
  const frontmatter = parseFrontmatter(raw);
  if (!frontmatter) return undefined;
  const name = textField(frontmatter.data, 'name');
  const description = textField(frontmatter.data, 'description');
  if (!name || !description || !SKILL_NAME.test(name)) return undefined;
  const whenToUse = textField(frontmatter.data, 'whenToUse');
  const metadata = recordField(frontmatter.data, 'metadata');
  return {
    name,
    description,
    ...(whenToUse ? { whenToUse } : {}),
    invocation: invocationPolicy(frontmatter.data),
    ...(metadata ? { metadata } : {}),
    content: frontmatter.body.trim(),
    file: resolved,
  };
}

function parseFrontmatter(
  raw: string,
): { data: Record<string, unknown>; body: string } | undefined {
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw);
  if (!match) return undefined;
  const data = parse(match[1]!) as unknown;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  return { data: data as Record<string, unknown>, body: match[2]! };
}

function invocationPolicy(data: Record<string, unknown>): SkillInvocationPolicy {
  return {
    modelInvocable: !booleanField(data, 'disable-model-invocation', false),
    userInvocable: booleanField(data, 'user-invocable', true),
  };
}

function booleanField(data: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = data[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new TypeError(`Skill frontmatter ${key} must be boolean`);
  return value;
}

function textField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function recordField(
  data: Record<string, unknown>,
  key: string,
): Readonly<Record<string, unknown>> | undefined {
  const value = data[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

async function isManagedProjection(directory: string): Promise<boolean> {
  try {
    await access(path.join(directory, '.repoctopus-managed.json'));
    return true;
  } catch {
    return false;
  }
}

function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
