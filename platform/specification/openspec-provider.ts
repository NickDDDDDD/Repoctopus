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
  type SpecificationSchemaInstructions,
  type SpecificationValidation,
  type SpecificationTaskSet,
} from '../../domains/specification/types.js';
import { parseSpecificationTasks } from '../../domains/specification/tasks.js';
import { createSpecificationPlanningManifest } from '../../domains/specification/planning-manifest.js';
import { atomicWriteJson } from '../filesystem/atomic-write.js';
import {
  Specification,
  type PrepareSpecificationClosureInput,
  type SpecificationRoot,
  type SpecificationWorkspace,
} from '../../services/specification.js';
import {
  installedOpenSpecVersion,
  OpenSpecProcess,
  type SpecificationProcessPort,
} from './openspec-process.js';

interface OpenSpecProviderConfig {
  workspaceRoot: string;
  specificationRoot: SpecificationRoot;
  process?: SpecificationProcessPort;
}

interface ContextResult {
  root?: {
    path?: unknown;
    source?: unknown;
    store_id?: unknown;
  } | null;
  status?: unknown;
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

interface InstructionsResult {
  artifactId?: unknown;
  schemaName?: unknown;
  instruction?: unknown;
  template?: unknown;
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
  if (id === 'verification') return 'verification';
  return undefined;
}

async function artifactDigest(
  workspace: string,
  value: unknown,
): Promise<`sha256:${string}` | undefined> {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const files = await Promise.all(
    value.map(async (candidate) => {
      if (typeof candidate !== 'string')
        throw new Error('OpenSpec returned an invalid artifact path');
      const absolute = path.resolve(workspace, candidate);
      const relative = path.relative(workspace, absolute);
      if (
        relative === '' ||
        relative === '..' ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      ) {
        throw new Error('OpenSpec artifact path escapes the workspace');
      }
      return {
        path: relative.split(path.sep).join('/'),
        digest: createHash('sha256')
          .update(await readFile(absolute))
          .digest('hex'),
      };
    }),
  );
  return sha256(files.sort((left, right) => left.path.localeCompare(right.path)));
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
  private readonly specificationRoot: SpecificationRoot;
  private readonly process: SpecificationProcessPort;

  constructor(context: Context, config: OpenSpecProviderConfig) {
    super(context);
    this.workspace = path.resolve(config.workspaceRoot);
    this.specificationRoot = structuredClone(config.specificationRoot);
    this.process = config.process ?? new OpenSpecProcess();
  }

  identity(): SpecificationProviderIdentity {
    return structuredClone(IDENTITY);
  }

  override root(): SpecificationRoot {
    return structuredClone(this.specificationRoot);
  }

  override async verifyRoot(signal?: AbortSignal): Promise<SpecificationRoot> {
    await this.assertRoot(this.workspace, signal);
    return this.root();
  }

  private async assertRoot(workspace: string, signal?: AbortSignal): Promise<void> {
    const result = await this.process.execute(
      ['context', '--json', '--store', this.specificationRoot.storeId],
      {
        cwd: workspace,
        ...(signal ? { signal } : {}),
      },
    );
    const parsed = parseJson<ContextResult>(result.stdout, 'context');
    if (result.exitCode !== 0 || !parsed.root) {
      const status = Array.isArray(parsed.status)
        ? parsed.status
            .map((entry) =>
              entry && typeof entry === 'object' && 'message' in entry
                ? String((entry as { message: unknown }).message)
                : '',
            )
            .filter(Boolean)
            .join('; ')
        : '';
      throw new Error(
        `OpenSpec Store ${this.specificationRoot.storeId} is unavailable: ${status || result.stderr.trim() || 'context resolution failed'}`,
      );
    }
    if (parsed.root.store_id !== this.specificationRoot.storeId) {
      throw new Error(
        `OpenSpec Store identity mismatch: expected ${this.specificationRoot.storeId}`,
      );
    }
    if (typeof parsed.root.path !== 'string') {
      throw new Error(`OpenSpec Store ${this.specificationRoot.storeId} returned no root path`);
    }
    if (path.resolve(parsed.root.path) !== path.resolve(workspace)) {
      throw new Error(
        `OpenSpec Store ${this.specificationRoot.storeId} is registered to a different checkout`,
      );
    }
  }

  private async json<T>(workspace: string, args: string[], signal?: AbortSignal): Promise<T> {
    const primaryRoot = path.resolve(workspace) === this.workspace;
    if (primaryRoot) await this.assertRoot(workspace, signal);
    const result = await this.process.execute(
      [...args, ...(primaryRoot ? ['--store', this.specificationRoot.storeId] : []), '--json'],
      {
        cwd: workspace,
        ...(signal ? { signal } : {}),
      },
    );
    if (result.exitCode !== 0) {
      const diagnostic = result.stderr.trim() || result.stdout.trim() || 'no diagnostic';
      throw new Error(`OpenSpec ${args.join(' ')} failed: ${diagnostic}`);
    }
    return parseJson<T>(result.stdout, args.join(' '));
  }

  async inspect(changeId: string, signal?: AbortSignal): Promise<SpecificationChange> {
    return this.inspectAt(this.workspace, changeId, signal);
  }

  override async tasks(changeId: string, signal?: AbortSignal): Promise<SpecificationTaskSet> {
    return this.tasksAt(this.workspace, changeId, signal);
  }

  private async tasksAt(
    workspace: string,
    changeId: string,
    signal?: AbortSignal,
  ): Promise<SpecificationTaskSet> {
    const id = changeId.trim();
    if (!id) throw new Error('Specification change id is required');
    const status = await this.json<StatusResult>(
      workspace,
      ['status', '--change', id],
      signal,
    );
    return this.taskSetFromPaths(workspace, id, status.artifactPaths?.tasks?.existingOutputPaths);
  }

  private async taskSetFromPaths(
    workspace: string,
    changeId: string,
    paths: unknown,
  ): Promise<SpecificationTaskSet> {
    if (!Array.isArray(paths) || paths.length !== 1 || typeof paths[0] !== 'string') {
      throw new Error('OpenSpec Tasks must resolve to exactly one official document');
    }
    const absolute = path.resolve(workspace, paths[0]);
    const relative = path.relative(workspace, absolute);
    if (
      relative === '' ||
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error('OpenSpec Tasks path escapes the workspace');
    }
    return parseSpecificationTasks(changeId, await readFile(absolute, 'utf8'));
  }

  override async planningInstructions(
    changeId: string,
    signal?: AbortSignal,
  ): Promise<SpecificationSchemaInstructions> {
    return this.planningInstructionsAt(this.workspace, changeId, signal);
  }

  private async planningInstructionsAt(
    workspace: string,
    changeId: string,
    signal?: AbortSignal,
  ): Promise<SpecificationSchemaInstructions> {
    const id = changeId.trim();
    if (!id) throw new Error('Specification change id is required');
    const artifactIds = ['proposal', 'specs', 'design', 'tasks'] as const;
    const results = await Promise.all(
      artifactIds.map((artifactId) =>
        this.json<InstructionsResult>(
          workspace,
          ['instructions', artifactId, '--change', id],
          signal,
        ),
      ),
    );
    const schemaNames = new Set<string>();
    const artifacts = results.map((result, index) => {
      const expectedId = artifactIds[index]!;
      const kind = artifactKind(expectedId);
      if (
        result.artifactId !== expectedId ||
        !kind ||
        kind === 'verification' ||
        typeof result.schemaName !== 'string' ||
        !result.schemaName.trim() ||
        typeof result.instruction !== 'string' ||
        !result.instruction.trim() ||
        typeof result.template !== 'string' ||
        !result.template.trim()
      ) {
        throw new Error(`OpenSpec returned invalid official instructions for ${expectedId}`);
      }
      schemaNames.add(result.schemaName);
      return {
        id: expectedId,
        kind,
        instructionDigest: sha256(result.instruction),
        templateDigest: sha256(result.template),
      };
    });
    if (schemaNames.size !== 1) {
      throw new Error('OpenSpec planning artifacts resolved to different schemas');
    }
    const stable = {
      schemaVersion: 1 as const,
      schemaName: [...schemaNames][0]!,
      provider: this.identity(),
      artifacts,
    };
    return { ...stable, digest: sha256(stable) };
  }

  private async inspectAt(
    workspace: string,
    changeId: string,
    signal?: AbortSignal,
  ): Promise<SpecificationChange> {
    const id = changeId.trim();
    if (!id) throw new Error('Specification change id is required');
    const [shown, status] = await Promise.all([
      this.json<ShowResult>(
        workspace,
        ['show', id, '--type', 'change', '--no-interactive'],
        signal,
      ),
      this.json<StatusResult>(workspace, ['status', '--change', id], signal),
    ]);
    const artifacts = (
      await Promise.all(
        Object.entries(status.artifactPaths ?? {}).map(
          async ([artifactId, artifact]): Promise<SpecificationArtifact | undefined> => {
            const kind = artifactKind(artifactId);
            if (!kind) return undefined;
            const digest =
              kind === 'tasks'
                ? (
                    await this.taskSetFromPaths(
                      workspace,
                      id,
                      artifact.existingOutputPaths,
                    )
                  ).digest
                : await artifactDigest(workspace, artifact.existingOutputPaths);
            return {
              id: artifactId,
              kind,
              status: digest ? 'ready' : 'missing',
              ...(digest ? { digest } : {}),
            };
          },
        ),
      )
    )
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
    return this.validateAt(this.workspace, changeId, options);
  }

  private async validateAt(
    workspace: string,
    changeId: string,
    options: { strict?: boolean; signal?: AbortSignal } = {},
  ): Promise<SpecificationValidation> {
    const args = ['validate', changeId, '--type', 'change', '--no-interactive'];
    if (options.strict !== false) args.push('--strict');
    const primaryRoot = path.resolve(workspace) === this.workspace;
    if (primaryRoot) await this.assertRoot(workspace, options.signal);
    const result = await this.process.execute(
      [...args, ...(primaryRoot ? ['--store', this.specificationRoot.storeId] : []), '--json'],
      {
        cwd: workspace,
        ...(options.signal ? { signal: options.signal } : {}),
      },
    );
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
    return this.prepareClosureAt(this.workspace, input);
  }

  private async prepareClosureAt(
    workspace: string,
    input: PrepareSpecificationClosureInput,
  ): Promise<SpecificationClosurePlan> {
    const [change, validation] = await Promise.all([
      this.inspectAt(workspace, input.changeId, input.signal),
      this.validateAt(workspace, input.changeId, {
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

  private receiptFile(workspace: string, planDigest: string): string {
    return path.join(
      workspace,
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
    return this.closeAt(this.workspace, plan, signal);
  }

  private async closeAt(
    workspace: string,
    plan: SpecificationClosurePlan,
    signal?: AbortSignal,
  ): Promise<SpecificationClosureResult> {
    const receipt = this.receiptFile(workspace, plan.planDigest);
    if (await exists(receipt)) {
      return JSON.parse(await readFile(receipt, 'utf8')) as SpecificationClosureResult;
    }
    const current = await this.prepareClosureAt(workspace, {
      changeId: plan.changeId,
      mergeFactsDigest: plan.mergeFactsDigest,
      targetBaselineDigest: plan.targetBaselineDigest,
      ...(signal ? { signal } : {}),
    });
    if (current.planDigest !== plan.planDigest) {
      throw new Error('Specification closure plan drifted before execution');
    }
    const openspecRoot = path.join(workspace, 'openspec');
    const before = await tree(openspecRoot);
    const archived = await this.json<ArchiveResult>(
      workspace,
      ['archive', plan.changeId, '--yes'],
      signal,
    );
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
    await atomicWriteJson(receipt, result, { containedRoot: workspace });
    return result;
  }

  override atWorkspace(workspaceRoot: string): SpecificationWorkspace {
    const workspace = path.resolve(workspaceRoot);
    return {
      identity: () => this.identity(),
      root: () => this.root(),
      verifyRoot: async (signal) => {
        await this.assertRoot(workspace, signal);
        return this.root();
      },
      planningInstructions: (changeId, signal) =>
        this.planningInstructionsAt(workspace, changeId, signal),
      planningManifest: async (changeId, signal) => {
        const [change, specificationRoot, schema] = await Promise.all([
          this.inspectAt(workspace, changeId, signal),
          (async () => {
            if (path.resolve(workspace) === this.workspace) {
              await this.assertRoot(workspace, signal);
            }
            return this.root();
          })(),
          this.planningInstructionsAt(workspace, changeId, signal),
        ]);
        return createSpecificationPlanningManifest({ change, specificationRoot, schema });
      },
      tasks: (changeId, signal) => this.tasksAt(workspace, changeId, signal),
      inspect: (changeId, signal) => this.inspectAt(workspace, changeId, signal),
      validate: (changeId, options) => this.validateAt(workspace, changeId, options),
      prepareClosure: (input) => this.prepareClosureAt(workspace, input),
      close: (plan, signal) => this.closeAt(workspace, plan, signal),
    };
  }
}
