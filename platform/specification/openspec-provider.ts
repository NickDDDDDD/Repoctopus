import { createHash } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import type { Context } from '@deepseek-ai/cordis';

import { canonicalJson } from '../../domains/workflow-contract/canonical.js';
import {
  SPECIFICATION_API_VERSION,
  type SpecificationArtifact,
  type SpecificationChange,
  type SpecificationClosurePlan,
  type SpecificationClosureResult,
  type SpecificationDiagnostic,
  type SpecificationProviderIdentity,
  type SpecificationValidation,
} from '../../domains/specification/types.js';
import { atomicWriteJson } from '../filesystem/atomic-write.js';
import {
  Specification,
  type PrepareSpecificationClosureInput,
} from '../../services/specification.js';
import {
  installedOpenSpecVersion,
  OpenSpecProcess,
  type SpecificationProcessPort,
} from './openspec-process.js';

interface OpenSpecProviderConfig {
  workspaceRoot: string;
  process?: SpecificationProcessPort;
}

interface ShowResult {
  id?: unknown;
  title?: unknown;
  deltas?: Array<{ spec?: unknown }>;
}

interface StatusResult {
  isPlanningComplete?: unknown;
  artifactPaths?: Record<string, { existingOutputPaths?: unknown }>;
}

interface ValidationResult {
  items?: Array<{ id?: unknown; valid?: unknown; issues?: unknown }>;
}

interface ArchiveResult {
  archive?: {
    archivedAs?: unknown;
    path?: unknown;
  };
}

const IDENTITY: SpecificationProviderIdentity = {
  id: 'openspec',
  version: installedOpenSpecVersion(),
  protocolVersion: SPECIFICATION_API_VERSION,
};

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function parseJson<T>(stdout: string, command: string): T {
  try {
    return JSON.parse(stdout) as T;
  } catch (cause) {
    throw new Error(`OpenSpec ${command} returned invalid JSON`, { cause });
  }
}

function artifactKind(id: string): SpecificationArtifact['kind'] | undefined {
  if (id === 'proposal') return 'proposal';
  if (id === 'design') return 'design';
  if (id === 'specs') return 'delta-specs';
  if (id === 'tasks') return 'tasks';
  if (id === 'verification' || id === 'implementation-notes') return 'verification';
  return undefined;
}

function diagnostics(value: unknown): SpecificationDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value.map((issue, index) => {
    const record = issue && typeof issue === 'object' ? (issue as Record<string, unknown>) : {};
    return {
      code: typeof record.code === 'string' ? record.code : `openspec.issue.${index + 1}`,
      severity: record.severity === 'warning' ? 'warning' : 'error',
      message:
        typeof record.message === 'string'
          ? record.message
          : typeof record.path === 'string'
            ? `OpenSpec validation failed at ${record.path}`
            : 'OpenSpec validation failed',
      ...(typeof record.path === 'string' ? { artifactId: record.path } : {}),
    };
  });
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function tree(root: string, prefix = ''): Promise<Map<string, string>> {
  const output = new Map<string, string>();
  if (!(await exists(root))) return output;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      for (const [file, digest] of await tree(absolute, relative)) output.set(file, digest);
    } else if (entry.isFile()) {
      output.set(
        relative,
        createHash('sha256')
          .update(await readFile(absolute))
          .digest('hex'),
      );
    }
  }
  return output;
}

export class OpenSpecProvider extends Specification {
  private readonly workspace: string;
  private readonly process: SpecificationProcessPort;

  constructor(context: Context, config: OpenSpecProviderConfig) {
    super(context);
    this.workspace = path.resolve(config.workspaceRoot);
    this.process = config.process ?? new OpenSpecProcess();
  }

  identity(): SpecificationProviderIdentity {
    return structuredClone(IDENTITY);
  }

  private async json<T>(args: string[], signal?: AbortSignal): Promise<T> {
    const result = await this.process.execute([...args, '--json'], {
      cwd: this.workspace,
      ...(signal ? { signal } : {}),
    });
    if (result.exitCode !== 0) {
      const diagnostic = result.stderr.trim() || result.stdout.trim() || 'no diagnostic';
      throw new Error(`OpenSpec ${args.join(' ')} failed: ${diagnostic}`);
    }
    return parseJson<T>(result.stdout, args.join(' '));
  }

  async inspect(changeId: string, signal?: AbortSignal): Promise<SpecificationChange> {
    const id = changeId.trim();
    if (!id) throw new Error('Specification change id is required');
    const [shown, status] = await Promise.all([
      this.json<ShowResult>(['show', id, '--type', 'change', '--no-interactive'], signal),
      this.json<StatusResult>(['status', '--change', id], signal),
    ]);
    const artifacts = Object.entries(status.artifactPaths ?? {})
      .map(([artifactId, artifact]): SpecificationArtifact | undefined => {
        const kind = artifactKind(artifactId);
        if (!kind) return undefined;
        const ready =
          Array.isArray(artifact.existingOutputPaths) && artifact.existingOutputPaths.length > 0;
        return { id: artifactId, kind, status: ready ? 'ready' : 'missing' };
      })
      .filter((artifact): artifact is SpecificationArtifact => artifact !== undefined)
      .sort((left, right) => left.id.localeCompare(right.id));
    const affectedCapabilities = [
      ...new Set(
        (shown.deltas ?? [])
          .map((delta) => delta.spec)
          .filter((spec): spec is string => typeof spec === 'string' && spec.length > 0),
      ),
    ].sort();
    const semantic = {
      id: typeof shown.id === 'string' ? shown.id : id,
      title: typeof shown.title === 'string' ? shown.title : id,
      planningComplete: status.isPlanningComplete === true,
      artifacts,
      affectedCapabilities,
      deltas: shown.deltas ?? [],
    };
    return {
      apiVersion: SPECIFICATION_API_VERSION,
      kind: 'SpecificationChange',
      changeId: semantic.id,
      title: semantic.title,
      provider: this.identity(),
      changeDigest: sha256(semantic),
      planningComplete: semantic.planningComplete,
      artifacts,
      affectedCapabilities,
    };
  }

  async validate(
    changeId: string,
    options: { strict?: boolean; signal?: AbortSignal } = {},
  ): Promise<SpecificationValidation> {
    const args = ['validate', changeId, '--type', 'change', '--no-interactive'];
    if (options.strict !== false) args.push('--strict');
    const result = await this.process.execute([...args, '--json'], {
      cwd: this.workspace,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const parsed = parseJson<ValidationResult>(result.stdout, args.join(' '));
    const item = parsed.items?.find((candidate) => candidate.id === changeId) ?? parsed.items?.[0];
    const findings = diagnostics(item?.issues);
    const valid = result.exitCode === 0 && item?.valid === true;
    if (!valid && findings.length === 0) {
      findings.push({
        code: 'openspec.validation-failed',
        severity: 'error',
        message: result.stderr.trim() || 'OpenSpec strict validation failed',
      });
    }
    const semantic = { changeId, strict: options.strict !== false, valid, diagnostics: findings };
    return {
      apiVersion: SPECIFICATION_API_VERSION,
      kind: 'SpecificationValidation',
      changeId,
      provider: this.identity(),
      strict: semantic.strict,
      valid,
      validationDigest: sha256(semantic),
      diagnostics: findings,
    };
  }

  async prepareClosure(input: PrepareSpecificationClosureInput): Promise<SpecificationClosurePlan> {
    const [change, validation] = await Promise.all([
      this.inspect(input.changeId, input.signal),
      this.validate(input.changeId, {
        strict: true,
        ...(input.signal ? { signal: input.signal } : {}),
      }),
    ]);
    if (!validation.valid) {
      throw new Error(`Specification change is not valid: ${input.changeId}`);
    }
    const base = {
      apiVersion: SPECIFICATION_API_VERSION,
      kind: 'SpecificationClosurePlan' as const,
      changeId: change.changeId,
      provider: this.identity(),
      changeDigest: change.changeDigest,
      mergeFactsDigest: input.mergeFactsDigest,
      targetBaselineDigest: input.targetBaselineDigest,
      affectedCapabilities: change.affectedCapabilities,
      allowedPathPrefixes: [
        ...change.affectedCapabilities.map((capability) => `openspec/specs/${capability}/`),
        `openspec/changes/${change.changeId}/`,
        'openspec/changes/archive/',
      ].sort(),
    };
    return { ...base, planDigest: sha256(base) };
  }

  private receiptFile(planDigest: string): string {
    return path.join(
      this.workspace,
      '.repoctopus',
      'specification',
      'closures',
      `${planDigest.replace('sha256:', '')}.json`,
    );
  }

  async close(
    plan: SpecificationClosurePlan,
    signal?: AbortSignal,
  ): Promise<SpecificationClosureResult> {
    const receipt = this.receiptFile(plan.planDigest);
    if (await exists(receipt)) {
      return JSON.parse(await readFile(receipt, 'utf8')) as SpecificationClosureResult;
    }
    const current = await this.prepareClosure({
      changeId: plan.changeId,
      mergeFactsDigest: plan.mergeFactsDigest,
      targetBaselineDigest: plan.targetBaselineDigest,
      ...(signal ? { signal } : {}),
    });
    if (current.planDigest !== plan.planDigest) {
      throw new Error('Specification closure plan drifted before execution');
    }
    const openspecRoot = path.join(this.workspace, 'openspec');
    const before = await tree(openspecRoot);
    const archived = await this.json<ArchiveResult>(['archive', plan.changeId, '--yes'], signal);
    const after = await tree(openspecRoot);
    const changedFiles = [...new Set([...before.keys(), ...after.keys()])]
      .filter((file) => before.get(file) !== after.get(file))
      .map((file) => `openspec/${file}`)
      .sort();
    const archiveId =
      typeof archived.archive?.archivedAs === 'string'
        ? archived.archive.archivedAs
        : typeof archived.archive?.path === 'string'
          ? path.basename(archived.archive.path)
          : `${plan.changeId}:${plan.planDigest.slice(7, 19)}`;
    const result: SpecificationClosureResult = {
      apiVersion: SPECIFICATION_API_VERSION,
      kind: 'SpecificationClosureResult',
      changeId: plan.changeId,
      provider: this.identity(),
      planDigest: plan.planDigest,
      closureId: sha256({ planDigest: plan.planDigest, archiveId }),
      status: 'closed',
      archiveId,
      changedFiles,
    };
    await atomicWriteJson(receipt, result, { containedRoot: this.workspace });
    return result;
  }
}
