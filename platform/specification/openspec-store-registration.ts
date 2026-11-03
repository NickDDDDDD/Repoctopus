import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { parse } from 'yaml';

import type {
  OpenSpecRootEvidence,
  OpenSpecRootDisposition,
} from '../../domains/project-configuration/detection.js';
import { canonicalJson } from '../../domains/workflow-contract/canonical.js';
import {
  installedOpenSpecVersion,
  OpenSpecProcess,
  type SpecificationProcessPort,
} from './openspec-process.js';

export const OPENSPEC_ROOT_INITIALIZATION_ARGS = [
  '--tools',
  'none',
  '--profile',
  'custom',
  '--language',
  'zh-CN',
  '--no-animation',
  '--no-copilot-cloud',
] as const;

export interface OpenSpecRootPreparationResult {
  status: 'initialized' | 'already-healthy' | 'recovered';
  evidence: OpenSpecRootEvidence;
  evidenceDigest: `sha256:${string}`;
}

export interface OpenSpecStoreRegistrationPort {
  inspect(input: { storeId: string; workspace: string }): Promise<OpenSpecRootEvidence>;
  prepareRoot(input: {
    expected: OpenSpecRootEvidence;
    allowRecovery: boolean;
  }): Promise<OpenSpecRootPreparationResult>;
  ensureRegistered(input: { storeId: string; workspace: string }): Promise<{
    status: 'registered' | 'already-registered';
    registrationDigest: `sha256:${string}`;
  }>;
}

interface StoreListResult {
  stores?: Array<{ id?: unknown; root?: unknown }>;
}

interface DoctorResult {
  root?: { path?: unknown; healthy?: unknown };
  status?: Array<{ code?: unknown }>;
}

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function comparablePath(value: string): string {
  const resolved = path.resolve(value).replaceAll('\\', '/');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function samePath(left: string, right: string): boolean {
  return comparablePath(left) === comparablePath(right);
}

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (cause) {
    throw new Error(`${label} returned invalid JSON`, { cause });
  }
}

async function pathKind(target: string): Promise<'missing' | 'directory' | 'other'> {
  try {
    const stat = await lstat(target);
    return stat.isDirectory() && !stat.isSymbolicLink() ? 'directory' : 'other';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw error;
  }
}

async function rootManifest(root: string): Promise<{
  digest: `sha256:${string}`;
  entries: Array<{ path: string; kind: 'directory' | 'file'; digest?: `sha256:${string}` }>;
}> {
  const entries: Array<{
    path: string;
    kind: 'directory' | 'file';
    digest?: `sha256:${string}`;
  }> = [];
  const walk = async (directory: string): Promise<void> => {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const absolute = path.join(directory, child.name);
      const relative = path.relative(root, absolute).replaceAll('\\', '/');
      if (child.isSymbolicLink()) {
        throw new Error(`OpenSpec Root contains a symbolic link: ${relative}`);
      }
      if (child.isDirectory()) {
        entries.push({ path: `${relative}/`, kind: 'directory' });
        await walk(absolute);
        continue;
      }
      if (!child.isFile()) {
        throw new Error(`OpenSpec Root contains an unsupported entry: ${relative}`);
      }
      const contents = await readFile(absolute);
      entries.push({
        path: relative,
        kind: 'file',
        digest: `sha256:${createHash('sha256').update(contents).digest('hex')}`,
      });
    }
  };
  await walk(root);
  return { digest: sha256(entries), entries };
}

async function metadataStoreId(workspace: string): Promise<string | null> {
  try {
    const contents = await readFile(path.join(workspace, '.openspec-store', 'store.yaml'), 'utf8');
    const value = parse(contents) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const id = (value as Record<string, unknown>).id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function evidence(input: {
  disposition: OpenSpecRootDisposition;
  workspaceRoot: string;
  storeId: string;
  registeredStoreId: string | null;
  registeredRoot: string | null;
  rootManifestDigest: `sha256:${string}` | null;
  diagnosticCode: string | null;
}): OpenSpecRootEvidence {
  const stable = {
    ...input,
    workspaceRoot: path.resolve(input.workspaceRoot),
    providerVersion: installedOpenSpecVersion(),
  };
  return { ...stable, digest: sha256(stable) };
}

async function recoverableInitialization(
  root: string,
  entries: readonly { path: string; kind: string }[],
): Promise<boolean> {
  const allowed = new Set([
    'changes/',
    'changes/archive/',
    'changes/archive/.gitkeep',
    'config.yaml',
    'specs/',
    'specs/.gitkeep',
  ]);
  const actual = new Set(entries.map((entry) => entry.path));
  if (actual.size !== allowed.size || ![...allowed].every((entry) => actual.has(entry))) {
    return false;
  }
  const config = parse(await readFile(path.join(root, 'config.yaml'), 'utf8')) as unknown;
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  const record = config as Record<string, unknown>;
  return (
    record.schema === 'spec-driven' &&
    typeof record.context === 'string' &&
    record.context.includes('Language: zh-CN')
  );
}

export class OpenSpecStoreRegistration implements OpenSpecStoreRegistrationPort {
  constructor(private readonly process: SpecificationProcessPort = new OpenSpecProcess()) {}

  async inspect(input: { storeId: string; workspace: string }): Promise<OpenSpecRootEvidence> {
    const workspace = path.resolve(input.workspace);
    const listed = await this.process.execute(['store', 'list', '--json'], { cwd: workspace });
    if (listed.exitCode !== 0) {
      throw new Error(`OpenSpec Store registry is unavailable: ${listed.stderr || listed.stdout}`);
    }
    const stores = parseJson<StoreListResult>(listed.stdout, 'OpenSpec Store list').stores ?? [];
    const normalizedStores = stores.flatMap((store) =>
      typeof store.id === 'string' && typeof store.root === 'string'
        ? [{ id: store.id, root: path.resolve(store.root) }]
        : [],
    );
    const idRegistration = normalizedStores.find((store) => store.id === input.storeId) ?? null;
    const pathRegistration =
      normalizedStores.find((store) => samePath(store.root, workspace)) ?? null;
    const conflict =
      (idRegistration && !samePath(idRegistration.root, workspace) ? idRegistration : null) ??
      (pathRegistration && pathRegistration.id !== input.storeId ? pathRegistration : null);

    const openspecRoot = path.join(workspace, 'openspec');
    const kind = await pathKind(openspecRoot);
    if (kind === 'missing') {
      return evidence({
        disposition: conflict ? 'conflicting-registration' : 'missing-root',
        workspaceRoot: workspace,
        storeId: input.storeId,
        registeredStoreId: conflict?.id ?? null,
        registeredRoot: conflict?.root ?? null,
        rootManifestDigest: null,
        diagnosticCode: conflict ? 'store-registration-conflict' : null,
      });
    }
    if (kind === 'other') {
      return evidence({
        disposition: 'partial-or-unhealthy',
        workspaceRoot: workspace,
        storeId: input.storeId,
        registeredStoreId: conflict?.id ?? null,
        registeredRoot: conflict?.root ?? null,
        rootManifestDigest: null,
        diagnosticCode: 'openspec-root-not-directory',
      });
    }

    const manifest = await rootManifest(openspecRoot);
    const doctor = await this.process.execute(['doctor', '--json'], { cwd: workspace });
    let doctorResult: DoctorResult | null = null;
    if (doctor.exitCode === 0) {
      doctorResult = parseJson<DoctorResult>(doctor.stdout, 'OpenSpec doctor');
    }
    const healthy =
      doctorResult?.root?.healthy === true &&
      typeof doctorResult.root.path === 'string' &&
      samePath(doctorResult.root.path, workspace);
    if (!healthy) {
      const firstCode = doctorResult?.status?.find((item) => typeof item.code === 'string')?.code;
      return evidence({
        disposition: 'partial-or-unhealthy',
        workspaceRoot: workspace,
        storeId: input.storeId,
        registeredStoreId: conflict?.id ?? null,
        registeredRoot: conflict?.root ?? null,
        rootManifestDigest: manifest.digest,
        diagnosticCode: typeof firstCode === 'string' ? firstCode : 'openspec-root-unhealthy',
      });
    }

    const metadataId = await metadataStoreId(workspace);
    if (conflict || (metadataId !== null && metadataId !== input.storeId)) {
      return evidence({
        disposition: 'conflicting-registration',
        workspaceRoot: workspace,
        storeId: input.storeId,
        registeredStoreId: conflict?.id ?? metadataId,
        registeredRoot: conflict?.root ?? workspace,
        rootManifestDigest: manifest.digest,
        diagnosticCode: conflict ? 'store-registration-conflict' : 'store-metadata-id-mismatch',
      });
    }

    if (idRegistration && samePath(idRegistration.root, workspace)) {
      const context = await this.process.execute(['context', '--json', '--store', input.storeId], {
        cwd: workspace,
      });
      if (context.exitCode !== 0) {
        return evidence({
          disposition: 'conflicting-registration',
          workspaceRoot: workspace,
          storeId: input.storeId,
          registeredStoreId: input.storeId,
          registeredRoot: workspace,
          rootManifestDigest: manifest.digest,
          diagnosticCode: 'store-context-unavailable',
        });
      }
      const parsed = parseJson<{ root?: { store_id?: unknown; path?: unknown } }>(
        context.stdout,
        'OpenSpec Store context',
      );
      if (
        parsed.root?.store_id !== input.storeId ||
        typeof parsed.root.path !== 'string' ||
        !samePath(parsed.root.path, workspace)
      ) {
        return evidence({
          disposition: 'conflicting-registration',
          workspaceRoot: workspace,
          storeId: input.storeId,
          registeredStoreId: input.storeId,
          registeredRoot: typeof parsed.root?.path === 'string' ? parsed.root.path : null,
          rootManifestDigest: manifest.digest,
          diagnosticCode: 'store-context-mismatch',
        });
      }
      return evidence({
        disposition: 'registered-exact',
        workspaceRoot: workspace,
        storeId: input.storeId,
        registeredStoreId: input.storeId,
        registeredRoot: workspace,
        rootManifestDigest: manifest.digest,
        diagnosticCode: null,
      });
    }

    return evidence({
      disposition: 'healthy-unregistered',
      workspaceRoot: workspace,
      storeId: input.storeId,
      registeredStoreId: null,
      registeredRoot: null,
      rootManifestDigest: manifest.digest,
      diagnosticCode: null,
    });
  }

  async prepareRoot(input: {
    expected: OpenSpecRootEvidence;
    allowRecovery: boolean;
  }): Promise<OpenSpecRootPreparationResult> {
    const current = await this.inspect({
      storeId: input.expected.storeId,
      workspace: input.expected.workspaceRoot,
    });
    if (input.expected.providerVersion !== installedOpenSpecVersion()) {
      throw new Error('OpenSpec Provider changed after project configuration approval');
    }

    if (input.expected.disposition === 'missing-root') {
      if (current.disposition === 'missing-root') {
        const initialized = await this.process.execute(
          ['init', input.expected.workspaceRoot, ...OPENSPEC_ROOT_INITIALIZATION_ARGS],
          { cwd: input.expected.workspaceRoot },
        );
        const observed = await this.inspect({
          storeId: input.expected.storeId,
          workspace: input.expected.workspaceRoot,
        });
        if (!['healthy-unregistered', 'registered-exact'].includes(observed.disposition)) {
          throw new Error(
            `OpenSpec Root initialization failed: ${initialized.stderr.trim() || initialized.stdout.trim() || observed.diagnosticCode}`,
          );
        }
        const manifest = await rootManifest(path.join(input.expected.workspaceRoot, 'openspec'));
        if (
          !(await recoverableInitialization(
            path.join(input.expected.workspaceRoot, 'openspec'),
            manifest.entries,
          ))
        ) {
          throw new Error('Initialized OpenSpec Root contains files outside the approved manifest');
        }
        return {
          status: initialized.exitCode === 0 ? 'initialized' : 'recovered',
          evidence: observed,
          evidenceDigest: observed.digest,
        };
      }
      if (
        input.allowRecovery &&
        ['healthy-unregistered', 'registered-exact'].includes(current.disposition)
      ) {
        const manifest = await rootManifest(path.join(input.expected.workspaceRoot, 'openspec'));
        if (
          !(await recoverableInitialization(
            path.join(input.expected.workspaceRoot, 'openspec'),
            manifest.entries,
          ))
        ) {
          throw new Error('OpenSpec Root recovery cannot prove initialization ownership');
        }
        return { status: 'recovered', evidence: current, evidenceDigest: current.digest };
      }
      throw new Error('OpenSpec Root changed after project configuration approval');
    }

    if (
      !['healthy-unregistered', 'registered-exact'].includes(input.expected.disposition) ||
      current.digest !== input.expected.digest
    ) {
      throw new Error(
        input.expected.diagnosticCode
          ? `OpenSpec Root is blocked: ${input.expected.diagnosticCode}`
          : 'OpenSpec Root changed after project configuration approval',
      );
    }
    return { status: 'already-healthy', evidence: current, evidenceDigest: current.digest };
  }

  async ensureRegistered(input: { storeId: string; workspace: string }): Promise<{
    status: 'registered' | 'already-registered';
    registrationDigest: `sha256:${string}`;
  }> {
    const before = await this.inspect(input);
    if (before.disposition === 'registered-exact') {
      return { status: 'already-registered', registrationDigest: before.digest };
    }
    if (before.disposition !== 'healthy-unregistered') {
      throw new Error(
        `OpenSpec Store registration requires a healthy root: ${before.diagnosticCode ?? before.disposition}`,
      );
    }
    const registered = await this.process.execute(
      ['store', 'register', input.workspace, '--id', input.storeId, '--yes', '--json'],
      { cwd: input.workspace },
    );
    const after = await this.inspect(input);
    if (after.disposition !== 'registered-exact') {
      throw new Error(
        `OpenSpec Store registration failed: ${registered.stderr.trim() || registered.stdout.trim() || after.diagnosticCode}`,
      );
    }
    return { status: 'registered', registrationDigest: after.digest };
  }
}
