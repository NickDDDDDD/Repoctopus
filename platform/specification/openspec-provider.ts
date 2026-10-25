import { createHash } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import type { Context } from '@deepseek-ai/cordis';
import { parse as parseYaml } from 'yaml';

import { canonicalJson } from '../../domains/workflow-contract/canonical.js';
import type { SpecificationFileIdentity } from '../../domains/specification/closure-journal.js';
import {
  SPECIFICATION_API_VERSION,
  type SpecificationArtifact,
  type SpecificationChange,
  type SpecificationClosurePlan,
  type SpecificationClosureResult,
  type SpecificationDiagnostic,
  type SpecificationProviderIdentity,
  type SpecificationSchemaInstructions,
  type SpecificationPlanningContext,
  type SpecificationValidation,
  type SpecificationTaskSet,
  type CompleteSpecificationTaskInput,
  type CompleteSpecificationTaskResult,
  type SpecificationFollowUpChange,
  type SpecificationFollowUpChangeInput,
  type SpecificationPhaseContext,
} from '../../domains/specification/types.js';
import {
  assertSpecificationTaskAcceptance,
  completeSpecificationTaskDocument,
  parseSpecificationTasks,
} from '../../domains/specification/tasks.js';
import { createSpecificationPlanningManifest } from '../../domains/specification/planning-manifest.js';
import { createSpecificationPlanningGuidance } from '../../domains/specification/planning-guidance.js';
import { atomicWriteJson, atomicWriteText } from '../filesystem/atomic-write.js';
import { GitSpecificationCheckoutManager } from '../git/specification-checkout.js';
import { execute } from '../process/execute.js';
import {
  Specification,
  createSpecificationPhaseContext,
  specificationPhaseArtifacts,
  type PrepareSpecificationClosureInput,
  type SpecificationRoot,
  type SpecificationWorkspace,
} from '../../services/specification.js';
import {
  installedOpenSpecVersion,
  OpenSpecProcess,
  type SpecificationProcessPort,
} from './openspec-process.js';
import { FileSpecificationClosureJournalStore } from './file-closure-journal-store.js';
import { IsolatedSpecificationClosureTransaction } from './isolated-closure-transaction.js';

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
  deltas?: Array<{ spec?: unknown; operation?: unknown }>;
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

function proposalCapabilityDescriptions(source: string): Map<string, string> {
  const descriptions = new Map<string, string>();
  let inCapabilities = false;
  let acceptsNewCapabilities = false;
  for (const line of source.split(/\r?\n/u)) {
    const heading = /^(#{2,3})\s+(.+?)\s*$/u.exec(line);
    if (heading?.[1] === '##') {
      inCapabilities = heading[2]?.trim().toLowerCase() === 'capabilities';
      // Older official templates put capability entries directly below the H2.
      acceptsNewCapabilities = inCapabilities;
      continue;
    }
    if (!inCapabilities) continue;
    if (heading?.[1] === '###') {
      acceptsNewCapabilities = heading[2]?.trim().toLowerCase() === 'new capabilities';
      continue;
    }
    if (!acceptsNewCapabilities) continue;
    const entry = /^\s*-\s+`([^`]+)`:\s+(.+?)\s*$/u.exec(line);
    if (entry?.[1] && entry[2]) descriptions.set(entry[1], entry[2]);
  }
  return descriptions;
}

function specificationPurpose(source: string): string | null {
  const lines = source.replaceAll('\r\n', '\n').split('\n');
  const start = lines.findIndex((line) => /^##\s+Purpose\s*$/iu.test(line));
  if (start < 0) return null;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/u.test(line)) break;
    body.push(line);
  }
  const purpose = body.join('\n').trim();
  return purpose || null;
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
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

async function normalizedTextTree(root: string, prefix = ''): Promise<Map<string, string>> {
  const output = new Map<string, string>();
  if (!(await exists(root))) return output;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      for (const [file, digest] of await normalizedTextTree(absolute, relative)) {
        output.set(file, digest);
      }
    } else if (entry.isFile()) {
      output.set(
        relative,
        createHash('sha256')
          .update((await readFile(absolute, 'utf8')).replaceAll('\r\n', '\n'))
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

  override async completeTask(
    input: CompleteSpecificationTaskInput,
  ): Promise<CompleteSpecificationTaskResult> {
    return this.completeTaskAt(this.workspace, input);
  }

  private async completeTaskAt(
    workspace: string,
    input: CompleteSpecificationTaskInput,
  ): Promise<CompleteSpecificationTaskResult> {
    const status = await this.json<StatusResult>(
      workspace,
      ['status', '--change', input.changeId],
      input.signal,
    );
    const paths = status.artifactPaths?.tasks?.existingOutputPaths;
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
    const original = await readFile(absolute, 'utf8');
    const completed = completeSpecificationTaskDocument({
      changeId: input.changeId,
      taskId: input.taskId,
      taskRevision: input.taskRevision,
      ...(input.workId ? { workId: input.workId } : {}),
      document: original,
    });
    if (completed.updated) {
      await atomicWriteText(absolute, completed.document, {
        containedRoot: workspace,
        beforeCommit: async () => {
          if ((await readFile(absolute, 'utf8')) !== original) {
            throw new Error('OpenSpec Tasks changed while projecting completion');
          }
        },
      });
    }
    if (input.workId) {
      const receiptFile = this.taskReceiptFile(workspace, input.changeId);
      const current = (await exists(receiptFile))
        ? await readJsonFile<{
            schemaVersion: 1;
            receipts: Array<{
              taskId: string;
              taskRevision: `sha256:${string}`;
              workId: string;
            }>;
          }>(receiptFile)
        : { schemaVersion: 1 as const, receipts: [] };
      const receipts = [
        ...current.receipts.filter((receipt) => receipt.taskId !== input.taskId),
        { taskId: input.taskId, taskRevision: input.taskRevision, workId: input.workId },
      ].sort((left, right) => left.taskId.localeCompare(right.taskId));
      await atomicWriteJson(receiptFile, { schemaVersion: 1, receipts });
    }
    return {
      schemaVersion: 1,
      changeId: input.changeId,
      taskId: input.taskId,
      taskRevision: input.taskRevision,
      updated: completed.updated,
      tasks: completed.tasks,
    };
  }

  private async tasksAt(
    workspace: string,
    changeId: string,
    signal?: AbortSignal,
  ): Promise<SpecificationTaskSet> {
    const id = changeId.trim();
    if (!id) throw new Error('Specification change id is required');
    const status = await this.json<StatusResult>(workspace, ['status', '--change', id], signal);
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
    const tasks = parseSpecificationTasks(changeId, await readFile(absolute, 'utf8'));
    const receiptFile = this.taskReceiptFile(workspace, changeId);
    if (!(await exists(receiptFile))) return tasks;
    const saved = await readJsonFile<{
      schemaVersion: 1;
      receipts: Array<{
        taskId: string;
        taskRevision: `sha256:${string}`;
        workId: string;
      }>;
    }>(receiptFile);
    if (saved.schemaVersion !== 1 || !Array.isArray(saved.receipts)) {
      throw new Error('Specification Task completion Receipt store is invalid');
    }
    return {
      ...tasks,
      tasks: tasks.tasks.map((task) => {
        const receipt = saved.receipts.find(
          (candidate) =>
            candidate.taskId === task.taskId && candidate.taskRevision === task.taskRevision,
        );
        return task.status === 'completed' && receipt
          ? { ...task, completion: { source: 'runtime-work' as const, workId: receipt.workId } }
          : task;
      }),
    };
  }

  private taskReceiptFile(workspace: string, changeId: string): string {
    const name = createHash('sha256').update(changeId).digest('hex');
    return path.join(workspace, '.repoctopus', 'specification-task-receipts', `${name}.json`);
  }

  override async planningInstructions(
    changeId: string,
    signal?: AbortSignal,
  ): Promise<SpecificationSchemaInstructions> {
    return this.planningInstructionsAt(this.workspace, changeId, signal);
  }

  override async planningContext(
    changeId: string,
    signal?: AbortSignal,
  ): Promise<SpecificationPlanningContext> {
    return this.planningContextAt(this.workspace, changeId, signal);
  }

  override async phaseContext(
    phase: SpecificationPhaseContext['phase'],
    changeId: string,
    signal?: AbortSignal,
  ): Promise<SpecificationPhaseContext> {
    return this.phaseContextAt(this.workspace, phase, changeId, signal);
  }

  private async phaseContextAt(
    workspace: string,
    phase: SpecificationPhaseContext['phase'],
    changeId: string,
    signal?: AbortSignal,
  ): Promise<SpecificationPhaseContext> {
    try {
      const planning = await this.planningContextAt(workspace, changeId, signal);
      return createSpecificationPhaseContext({
        phase,
        provider: this.identity(),
        artifacts: specificationPhaseArtifacts(phase, planning.artifacts),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (phase !== 'open' || !/change .* not found|no changes exist/iu.test(message)) throw error;
      const instruction =
        'Bootstrap the named change through the configured OpenSpec Store, then write only the proposal artifact required by this Work.';
      const template =
        'Use the proposal template generated by the configured OpenSpec schema; do not create design, specs, tasks, or additional planning artifacts in Open.';
      return createSpecificationPhaseContext({
        phase,
        provider: this.identity(),
        artifacts: [
          {
            id: 'proposal',
            kind: 'proposal',
            instruction,
            template,
            instructionDigest: sha256(instruction),
            templateDigest: sha256(template),
          },
        ],
      });
    }
  }

  private async planningInstructionsAt(
    workspace: string,
    changeId: string,
    signal?: AbortSignal,
  ): Promise<SpecificationSchemaInstructions> {
    const context = await this.planningContextAt(workspace, changeId, signal);
    const stable = {
      schemaVersion: 1 as const,
      schemaName: context.schemaName,
      provider: structuredClone(context.provider),
      artifacts: context.artifacts.map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
        instructionDigest: artifact.instructionDigest,
        templateDigest: artifact.templateDigest,
      })),
    };
    return { ...stable, digest: sha256(stable) };
  }

  private async planningContextAt(
    workspace: string,
    changeId: string,
    signal?: AbortSignal,
  ): Promise<SpecificationPlanningContext> {
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
        instruction: result.instruction,
        template: result.template,
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
            const outputs = artifact.existingOutputPaths;
            const digest =
              kind === 'tasks'
                ? Array.isArray(outputs) && outputs.length === 0
                  ? null
                  : (await this.taskSetFromPaths(workspace, id, outputs)).digest
                : await artifactDigest(workspace, outputs);
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
    const metadataFile = path.join(workspace, 'openspec', 'changes', id, '.openspec.yaml');
    const metadata = (await exists(metadataFile))
      ? (parseYaml(await readFile(metadataFile, 'utf8')) as unknown)
      : null;
    const metadataDigest = metadata === null ? null : sha256(metadata);
    const retirementEnabled =
      metadata !== null &&
      typeof metadata === 'object' &&
      (metadata as Record<string, unknown>).retire_capabilities === true;
    const operations = new Map<string, string[]>();
    for (const delta of shown.deltas ?? []) {
      if (typeof delta.spec !== 'string' || typeof delta.operation !== 'string') continue;
      operations.set(delta.spec, [...(operations.get(delta.spec) ?? []), delta.operation]);
    }
    const retiredCapabilities = retirementEnabled
      ? [...operations.entries()]
          .filter(([, capabilityOperations]) =>
            capabilityOperations.every((operation) => operation === 'REMOVED'),
          )
          .map(([capability]) => capability)
          .sort()
      : [];
    const semantic = {
      id: typeof shown.id === 'string' ? shown.id : id,
      title: typeof shown.title === 'string' ? shown.title : id,
      planningComplete: status.isPlanningComplete === true,
      artifacts,
      affectedCapabilities,
      retiredCapabilities,
      metadataDigest,
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
      retiredCapabilities,
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
    let valid = result.exitCode === 0 && item?.valid === true;
    if (valid && options.strict !== false) {
      try {
        const tasks = await this.tasksAt(workspace, changeId, options.signal);
        assertSpecificationTaskAcceptance(tasks.tasks);
      } catch (error) {
        valid = false;
        findings.push({
          code: 'repoctopus.task-acceptance-missing',
          severity: 'error',
          message: error instanceof Error ? error.message : String(error),
          artifactId: 'tasks',
        });
      }
    }
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
    await this.newCapabilityPurposesAt(workspace, change.changeId, change.affectedCapabilities);
    const changeFiles = await normalizedTextTree(
      path.join(workspace, 'openspec', 'changes', change.changeId),
    );
    const closureChangeDigest = sha256(
      [...changeFiles.entries()]
        .map(([file, digest]) => ({ file, digest }))
        .sort((left, right) => left.file.localeCompare(right.file)),
    );
    const base = {
      apiVersion: SPECIFICATION_API_VERSION,
      kind: 'SpecificationClosurePlan' as const,
      changeId: change.changeId,
      provider: this.identity(),
      changeDigest: closureChangeDigest,
      mergeFactsDigest: input.mergeFactsDigest,
      targetBaselineDigest: input.targetBaselineDigest,
      affectedCapabilities: change.affectedCapabilities,
      retiredCapabilities: change.retiredCapabilities,
      allowedPathPrefixes: [
        ...change.affectedCapabilities.map((capability) => `openspec/specs/${capability}/`),
        `openspec/changes/${change.changeId}/`,
        'openspec/changes/archive/',
      ].sort(),
    };
    return { ...base, planDigest: sha256(base) };
  }

  private async newCapabilityPurposesAt(
    workspace: string,
    changeId: string,
    affectedCapabilities: readonly string[],
  ): Promise<Map<string, string>> {
    const changeRoot = path.join(workspace, 'openspec', 'changes', changeId);
    return this.newCapabilityPurposesFromChangeAt(
      workspace,
      changeRoot,
      affectedCapabilities,
      async (capability) =>
        exists(path.join(workspace, 'openspec', 'specs', capability, 'spec.md')),
    );
  }

  private async newCapabilityPurposesFromChangeAt(
    workspace: string,
    changeRoot: string,
    affectedCapabilities: readonly string[],
    capabilityExisted: (capability: string) => boolean | Promise<boolean>,
  ): Promise<Map<string, string>> {
    const proposal = await readFile(path.join(changeRoot, 'proposal.md'), 'utf8');
    const descriptions = proposalCapabilityDescriptions(proposal);
    const purposes = new Map<string, string>();
    for (const capability of affectedCapabilities) {
      if (await capabilityExisted(capability)) continue;
      const deltaSpec = path.join(changeRoot, 'specs', capability, 'spec.md');
      const explicitPurpose = (await exists(deltaSpec))
        ? specificationPurpose(await readFile(deltaSpec, 'utf8'))
        : null;
      const purpose = explicitPurpose ?? descriptions.get(capability)?.trim();
      if (!purpose) {
        throw new Error(
          `New capability ${capability} requires a Proposal capability description before Archive`,
        );
      }
      purposes.set(capability, purpose);
    }
    return purposes;
  }

  private async completeNewCapabilityPurposesAt(
    workspace: string,
    changeId: string,
    purposes: ReadonlyMap<string, string>,
  ): Promise<void> {
    for (const [capability, purpose] of purposes) {
      const file = path.join(workspace, 'openspec', 'specs', capability, 'spec.md');
      const source = await readFile(file, 'utf8');
      const placeholder = `TBD - created by archiving change ${changeId}. Update Purpose after archive.`;
      if (!source.includes(placeholder)) continue;
      await atomicWriteText(file, source.replace(placeholder, purpose), {
        containedRoot: workspace,
      });
    }
  }

  private async assertArchivedSpecificationsAt(
    workspace: string,
    capabilities: readonly string[],
    signal?: AbortSignal,
  ): Promise<void> {
    const storeArgs =
      path.resolve(workspace) === this.workspace ? ['--store', this.specificationRoot.storeId] : [];
    for (const capability of capabilities) {
      const args = [
        'validate',
        capability,
        '--type',
        'spec',
        '--no-interactive',
        '--strict',
        ...storeArgs,
        '--json',
      ];
      const result = await this.process.execute(args, {
        cwd: workspace,
        ...(signal ? { signal } : {}),
      });
      const parsed = parseJson<ValidationResult>(result.stdout, args.join(' '));
      const item =
        parsed.items?.find((candidate) => candidate.id === capability) ?? parsed.items?.[0];
      if (result.exitCode !== 0 || item?.valid !== true) {
        const findings = diagnostics(item?.issues);
        throw new Error(
          `Archived Specification is not valid: ${capability}${
            findings.length > 0 ? ` (${findings.map((finding) => finding.message).join('; ')})` : ''
          }`,
        );
      }
    }
  }

  private async assertStrictStoreAt(workspace: string, signal?: AbortSignal): Promise<void> {
    const args = [
      'validate',
      '--all',
      '--strict',
      '--no-interactive',
      ...(path.resolve(workspace) === this.workspace
        ? ['--store', this.specificationRoot.storeId]
        : []),
      '--json',
    ];
    const result = await this.process.execute(args, {
      cwd: workspace,
      ...(signal ? { signal } : {}),
    });
    const parsed = parseJson<ValidationResult>(result.stdout, args.join(' '));
    if (
      result.exitCode !== 0 ||
      !parsed.items?.length ||
      parsed.items.some((item) => item.valid !== true)
    ) {
      throw new Error('Archived Specification Store failed strict validation');
    }
  }

  private async assertClosurePostconditionsAt(input: {
    workspace: string;
    plan: SpecificationClosurePlan;
    archiveId: string;
    changedFiles: readonly string[];
    purposes: ReadonlyMap<string, string>;
    signal?: AbortSignal;
  }): Promise<void> {
    if (await exists(path.join(input.workspace, 'openspec', 'changes', input.plan.changeId))) {
      throw new Error('Archived Specification still contains the active Change');
    }
    const archiveRoot = path.join(input.workspace, 'openspec', 'changes', 'archive');
    const matchingArchives = (await readdir(archiveRoot, { withFileTypes: true })).filter(
      (entry) => entry.isDirectory() && entry.name === input.archiveId,
    );
    if (matchingArchives.length !== 1) {
      throw new Error('Archived Specification must contain exactly one expected archive');
    }
    for (const [capability, purpose] of input.purposes) {
      const source = await readFile(
        path.join(input.workspace, 'openspec', 'specs', capability, 'spec.md'),
        'utf8',
      );
      if (!source.includes('## Purpose') || !source.includes(purpose)) {
        throw new Error(`Archived Specification Purpose was not synchronized: ${capability}`);
      }
    }
    for (const capability of input.plan.retiredCapabilities) {
      if (await exists(path.join(input.workspace, 'openspec', 'specs', capability, 'spec.md'))) {
        throw new Error(`Archived Specification capability was not retired: ${capability}`);
      }
    }
    const activeCapabilities = input.plan.affectedCapabilities.filter(
      (capability) => !input.plan.retiredCapabilities.includes(capability),
    );
    await this.assertArchivedSpecificationsAt(input.workspace, activeCapabilities, input.signal);
    await this.assertStrictStoreAt(input.workspace, input.signal);
    const outside = input.changedFiles.filter(
      (file) =>
        !input.plan.allowedPathPrefixes.some((prefix) =>
          file.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`),
        ),
    );
    if (outside.length > 0) {
      throw new Error(
        `Archived Specification changed paths outside the closure plan: ${outside.join(', ')}`,
      );
    }
  }

  async close(
    plan: SpecificationClosurePlan,
    signal?: AbortSignal,
  ): Promise<SpecificationClosureResult> {
    return this.closeAt(this.workspace, plan, signal);
  }

  override openFollowUp(
    input: SpecificationFollowUpChangeInput,
  ): Promise<SpecificationFollowUpChange> {
    return this.openFollowUpAt(this.workspace, input);
  }

  private async openFollowUpAt(
    workspace: string,
    input: SpecificationFollowUpChangeInput,
  ): Promise<SpecificationFollowUpChange> {
    if (
      !/^[a-z0-9][a-z0-9-]*$/u.test(input.changeId) ||
      !input.originalChangeId.trim() ||
      !/^sha256:[a-f0-9]{64}$/u.test(input.publicationReceiptDigest) ||
      !input.rationale.trim() ||
      input.affectedMergeRequests.length === 0
    ) {
      throw new Error('Follow-up Specification Change input is invalid');
    }
    const active = path.join(workspace, 'openspec', 'changes', input.changeId);
    if (await exists(active))
      throw new Error(`Follow-up Specification Change already exists: ${input.changeId}`);
    await this.json<unknown>(workspace, ['new', 'change', input.changeId], input.signal);
    const references = input.affectedMergeRequests
      .map(
        (mergeRequest) =>
          `- ${mergeRequest.provider}:${mergeRequest.repositoryId}#${mergeRequest.number} (${mergeRequest.url})`,
      )
      .join('\n');
    const proposal = `# Proposal

## Why

已完成 Change \`${input.originalChangeId}\` 的发布后语义审查确认需要规格修正。原 Publication Receipt：\`${input.publicationReceiptDigest}\`。

${input.rationale}

受影响的 Merge Request：

${references}

## What Changes

- 重新评估上述远端变更对已接受行为契约的影响。
- 通过本普通 OpenSpec Change 更新必要的 Delta Specs、Design 和 Tasks。
- 不修改原归档 Change、Closure Receipt 或已完成 Run。

## Capabilities

### Modified Capabilities

- 待 Design 阶段根据审查证据确定。

## Impact

本 Change 从标准 Open 阶段进入 Design 审批；在规格影响范围获批前不得开始 Build。
`;
    await atomicWriteText(path.join(active, 'proposal.md'), proposal, { containedRoot: workspace });
    return {
      apiVersion: SPECIFICATION_API_VERSION,
      kind: 'SpecificationFollowUpChange',
      changeId: input.changeId,
      originalChangeId: input.originalChangeId,
      publicationReceiptDigest: input.publicationReceiptDigest,
      status: 'opened',
      lifecycleEntry: 'open',
      proposalDigest: sha256(proposal),
    };
  }

  private async closeAt(
    workspace: string,
    plan: SpecificationClosurePlan,
    signal?: AbortSignal,
  ): Promise<SpecificationClosureResult> {
    const journals = new FileSpecificationClosureJournalStore(workspace);
    const priorReceipt = await journals.loadReceipt(plan.planDigest);
    if (priorReceipt) {
      const priorCheckout = await new GitSpecificationCheckoutManager(workspace).find(
        priorReceipt.candidate.checkoutId,
      );
      if (!priorCheckout) return priorReceipt;
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
    const status = await execute('git', ['status', '--porcelain=v1', '--', 'openspec'], {
      cwd: workspace,
      ...(signal ? { signal } : {}),
    });
    if (status.stdout.trim()) {
      throw new Error('Specification closure requires a clean OpenSpec working tree');
    }
    const checkouts = new GitSpecificationCheckoutManager(workspace);
    const transaction = new IsolatedSpecificationClosureTransaction(
      journals,
      checkouts,
      (checkoutRoot, closurePlan, transactionSignal) =>
        this.executeOfficialClosureAt(checkoutRoot, closurePlan, transactionSignal),
      undefined,
      (checkoutRoot, closurePlan, before, changedFiles, transactionSignal) =>
        this.recoverOfficialClosureAt(
          checkoutRoot,
          closurePlan,
          before,
          changedFiles,
          transactionSignal,
        ),
    );
    const execution = await transaction.execute(plan, signal);
    const currentHead = (
      await execute('git', ['rev-parse', 'HEAD'], {
        cwd: workspace,
        ...(signal ? { signal } : {}),
      })
    ).stdout.trim();
    if (currentHead !== execution.checkout.head) {
      throw new Error('Specification closure source HEAD changed after isolated validation');
    }
    return execution.result;
  }

  private async executeOfficialClosureAt(
    workspace: string,
    plan: SpecificationClosurePlan,
    signal?: AbortSignal,
  ): Promise<Omit<SpecificationClosureResult, 'candidate'>> {
    const current = await this.prepareClosureAt(workspace, {
      changeId: plan.changeId,
      mergeFactsDigest: plan.mergeFactsDigest,
      targetBaselineDigest: plan.targetBaselineDigest,
      ...(signal ? { signal } : {}),
    });
    if (current.planDigest !== plan.planDigest) {
      const drift = (Object.keys(plan) as Array<keyof SpecificationClosurePlan>).filter(
        (field) => canonicalJson(current[field]) !== canonicalJson(plan[field]),
      );
      throw new Error(
        `Specification closure plan drifted inside the isolated checkout: ${drift.join(', ')}`,
      );
    }
    const newCapabilityPurposes = await this.newCapabilityPurposesAt(
      workspace,
      plan.changeId,
      plan.affectedCapabilities,
    );
    const openspecRoot = path.join(workspace, 'openspec');
    const before = await tree(openspecRoot);
    const archived = await this.json<ArchiveResult>(
      workspace,
      ['archive', plan.changeId, '--yes'],
      signal,
    );
    await this.completeNewCapabilityPurposesAt(workspace, plan.changeId, newCapabilityPurposes);
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
    await this.assertClosurePostconditionsAt({
      workspace,
      plan,
      archiveId,
      changedFiles,
      purposes: newCapabilityPurposes,
      ...(signal ? { signal } : {}),
    });
    const result: Omit<SpecificationClosureResult, 'candidate'> = {
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
    return result;
  }

  private async recoverOfficialClosureAt(
    workspace: string,
    plan: SpecificationClosurePlan,
    before: readonly SpecificationFileIdentity[],
    changedFiles: readonly string[],
    signal?: AbortSignal,
  ): Promise<Omit<SpecificationClosureResult, 'candidate'>> {
    const archiveRoot = path.join(workspace, 'openspec', 'changes', 'archive');
    const candidates = (await readdir(archiveRoot, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isDirectory() &&
          changedFiles.some((file) => file.startsWith(`openspec/changes/archive/${entry.name}/`)),
      )
      .map((entry) => entry.name);
    if (candidates.length !== 1) {
      throw new Error('Interrupted Specification closure does not have one recoverable archive');
    }
    const archiveId = candidates[0]!;
    const beforePaths = new Set(before.map((file) => file.path));
    const purposes = await this.newCapabilityPurposesFromChangeAt(
      workspace,
      path.join(archiveRoot, archiveId),
      plan.affectedCapabilities,
      (capability) => beforePaths.has(`openspec/specs/${capability}/spec.md`),
    );
    await this.assertClosurePostconditionsAt({
      workspace,
      plan,
      archiveId,
      changedFiles,
      purposes,
      ...(signal ? { signal } : {}),
    });
    return {
      apiVersion: SPECIFICATION_API_VERSION,
      kind: 'SpecificationClosureResult',
      changeId: plan.changeId,
      provider: this.identity(),
      planDigest: plan.planDigest,
      closureId: sha256({ planDigest: plan.planDigest, archiveId }),
      status: 'closed',
      archiveId,
      changedFiles: [...changedFiles].sort(),
    };
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
      planningContext: (changeId, signal) => this.planningContextAt(workspace, changeId, signal),
      phaseContext: (phase, changeId, signal) =>
        this.phaseContextAt(workspace, phase, changeId, signal),
      planningGuidance: async (changeId, signal) =>
        createSpecificationPlanningGuidance(
          await this.planningInstructionsAt(workspace, changeId, signal),
        ),
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
      completeTask: (input) => this.completeTaskAt(workspace, input),
      inspect: (changeId, signal) => this.inspectAt(workspace, changeId, signal),
      validate: (changeId, options) => this.validateAt(workspace, changeId, options),
      prepareClosure: (input) => this.prepareClosureAt(workspace, input),
      close: (plan, signal) => this.closeAt(workspace, plan, signal),
      openFollowUp: (input) => this.openFollowUpAt(workspace, input),
    };
  }
}
