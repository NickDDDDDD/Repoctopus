import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { build } from 'esbuild';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { bootProjectComposition } from '../app/boot/bootstrap.js';
import { compositionIdentity } from '../app/boot/composition.js';
import { createProjectSnapshot, reconcileProjectSnapshots } from '../domains/project/snapshot.js';
import { WorkflowRunCoordinator } from '../domains/runtime/workflow-runs.js';
import type { DeliveryIntentV3, DeliveryPolicy } from '../domains/delivery/types.js';
import type { ResumeView, RunStatusView, RuntimeResult } from '../domains/runtime/types.js';
import type { RunStoreInspection } from '../domains/runtime/types.js';
import type { SpecificationApprovalState } from '../domains/specification/types.js';
import { createWorkExecutionSubmission } from '../domains/work-execution/submission.js';
import type { WorkExecutionResult } from '../domains/work-execution/types.js';
import { FileRuntimeStore } from '../platform/runtime/file-runtime-store.js';
import type {
  ExecuteArchiveDeliveryResult,
  VerifyChangeRunResult,
} from '../services/workflow-runs.js';
import {
  createGitRepository,
  createOpenSpecStoreEnvironment,
  removeTemporaryDirectory,
  temporaryDirectory,
} from './helpers/fixtures.js';
import { installCapturingWorkExecutionHost } from './helpers/capturing-work-execution-host.js';
import { runCli } from './e2e/cli.js';

const execFileAsync = promisify(execFile);
const productRoot = path.resolve(import.meta.dirname, '..');
const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

const policy: DeliveryPolicy = {
  apiVersion: 'repoctopus/v1alpha1',
  kind: 'DeliveryPolicy',
  checkpoint: {
    automatic: false,
    protectedBranches: ['main'],
    commitMessagePattern: '.+',
    quickChecks: {},
  },
  publication: {
    remote: 'origin',
    provider: 'github',
    githubApiBaseUrl: 'https://api.github.com',
    mrTitleTemplate: '{{changeId}}',
    mrBodyTemplate: '{{verificationReport}}',
  },
};

describe('managed Change execution production composition', () => {
  it.each([
    {
      label: 'autonomous mode with one business repository',
      executionMode: 'autonomous' as const,
      multiRepository: false,
    },
    {
      label: 'autonomous mode with two business repositories',
      executionMode: 'autonomous' as const,
      multiRepository: true,
    },
    {
      label: 'subagent-driven-development mode with two business repositories',
      executionMode: 'subagent-driven-development' as const,
      multiRepository: true,
    },
    {
      label: 'derived output drift blocks direct Archive Close',
      executionMode: 'autonomous' as const,
      multiRepository: true,
      derivedCloseDrift: true,
    },
    {
      label: 'protected writable repositories fail closed before Execute',
      executionMode: 'autonomous' as const,
      multiRepository: true,
      protectedWriteRepositories: true,
    },
    {
      label: 'matching protected branch reconciliation poison recovers in the same Run',
      executionMode: 'autonomous' as const,
      multiRepository: true,
      protectedWriteRepositories: true,
      prepoisonedProtectedRecovery: true,
    },
  ])(
    'executes fresh Open -> Design -> Build -> Verify -> Archive in $label',
    async ({
      executionMode,
      multiRepository,
      protectedWriteRepositories = false,
      prepoisonedProtectedRecovery = false,
      derivedCloseDrift = false,
    }) => {
      const root = await temporaryDirectory('repoctopus-managed-change-');
      cleanup.push(root);
      const workspaceRemote = path.join(root, 'workspace.git');
      const appRemote = path.join(root, 'app.git');
      const workerRemote = path.join(root, 'worker.git');
      await mkdir(workspaceRemote);
      await mkdir(appRemote);
      await mkdir(workerRemote);
      await execFileAsync('git', ['init', '--bare', '--initial-branch=main'], {
        cwd: workspaceRemote,
      });
      await execFileAsync('git', ['init', '--bare', '--initial-branch=main'], { cwd: appRemote });
      await execFileAsync('git', ['init', '--bare', '--initial-branch=main'], {
        cwd: workerRemote,
      });
      const workspace = await createGitRepository(root, 'workspace', workspaceRemote);
      const appRepository = await createGitRepository(root, 'app', appRemote);
      const workerRepository = await createGitRepository(root, 'worker', workerRemote);
      if (derivedCloseDrift)
        await writeFile(path.join(appRepository, '.git', 'info', 'exclude'), 'evidence-dist/\n');
      // Keep portable remote identities stable from Run creation through publication.
      for (const [repository, remote] of [
        [workspace, workspaceRemote],
        [appRepository, appRemote],
        [workerRepository, workerRemote],
      ]) {
        await execFileAsync(
          'git',
          [
            'remote',
            'set-url',
            'origin',
            path.relative(repository!, remote!).replaceAll('\\', '/'),
          ],
          { cwd: repository },
        );
      }
      await execFileAsync('git', ['push', '--set-upstream', 'origin', 'main'], { cwd: workspace });
      await execFileAsync('git', ['push', '--set-upstream', 'origin', 'main'], {
        cwd: appRepository,
      });
      await execFileAsync('git', ['push', '--set-upstream', 'origin', 'main'], {
        cwd: workerRepository,
      });
      await execFileAsync('git', ['switch', '-c', 'spec/managed-blackbox'], { cwd: workspace });
      await execFileAsync('git', ['push', '--set-upstream', 'origin', 'spec/managed-blackbox'], {
        cwd: workspace,
      });
      const prepareBuildBranches = async () => {
        await execFileAsync('git', ['switch', '-c', 'feature/managed-blackbox'], {
          cwd: appRepository,
        });
        await execFileAsync(
          'git',
          ['push', '--set-upstream', 'origin', 'feature/managed-blackbox'],
          { cwd: appRepository },
        );
        await execFileAsync('git', ['switch', '-c', 'feature/managed-blackbox'], {
          cwd: workerRepository,
        });
        await execFileAsync(
          'git',
          ['push', '--set-upstream', 'origin', 'feature/managed-blackbox'],
          { cwd: workerRepository },
        );
      };
      const environment = await createOpenSpecStoreEnvironment(root, workspace, 'managed-blackbox');
      await writeFile(path.join(workspace, '.gitignore'), '.repoctopus/\n');
      await mkdir(path.join(workspace, '.agents', 'skills', 'team-build-guidance'), {
        recursive: true,
      });
      await mkdir(path.join(workspace, '.agents', 'skills', 'team-design-method'), {
        recursive: true,
      });
      await writeFile(
        path.join(workspace, '.agents', 'skills', 'team-build-guidance', 'SKILL.md'),
        '---\nname: team-build-guidance\ndescription: Team Build guidance used by the production E2E.\n---\n\nPreserve the Runtime-owned Work contract and report bounded evidence.\n',
      );
      await writeFile(
        path.join(workspace, '.agents', 'skills', 'team-design-method', 'SKILL.md'),
        '---\nname: team-design-method\ndescription: Team Design method used by the production E2E.\n---\n\nValidate design decisions against repository facts before editing artifacts.\n',
      );
      await writeFile(
        path.join(workspace, 'repoctopus.yaml'),
        JSON.stringify({
          apiVersion: 'repoctopus/v1alpha1',
          kind: 'RepoctopusWorkspace',
          workspace: { id: 'managed-blackbox', repositoryId: 'workspace' },
          repositories: [
            { id: 'workspace', path: '.' },
            { id: 'app', path: '../app' },
            ...(multiRepository ? [{ id: 'worker', path: '../worker' }] : []),
          ],
          profiles: [
            {
              id: 'verify',
              nodes: [
                {
                  id: 'app-check',
                  type: 'command',
                  repository: 'app',
                  covers: ['*'],
                  executable: process.execPath,
                  args: [
                    '-e',
                    derivedCloseDrift
                      ? "const fs=require('node:fs');fs.mkdirSync('evidence-dist',{recursive:true});fs.writeFileSync('evidence-dist/value.txt','proof')"
                      : 'process.exit(0)',
                  ],
                  ...(derivedCloseDrift
                    ? {
                        inputs: {
                          schemaVersion: 1,
                          repositories: [{ repository: 'app', outputs: ['evidence-dist/**'] }],
                          git: 'none',
                          taskCheckboxes: 'ignore',
                          env: [],
                        },
                      }
                    : {}),
                },
                ...(multiRepository
                  ? [
                      {
                        id: 'worker-check',
                        type: 'command',
                        repository: 'worker',
                        covers: ['*'],
                        executable: process.execPath,
                        args: [
                          '-e',
                          derivedCloseDrift
                            ? "if(require('node:fs').readFileSync('../app/evidence-dist/value.txt','utf8')!=='proof')process.exit(1)"
                            : 'process.exit(0)',
                        ],
                        ...(derivedCloseDrift
                          ? {
                              dependsOn: ['app-check'],
                              inputs: {
                                schemaVersion: 1,
                                repositories: [
                                  { repository: 'app', files: ['evidence-dist/**'], outputs: [] },
                                  { repository: 'worker', outputs: [] },
                                ],
                                git: 'none',
                                taskCheckboxes: 'ignore',
                                env: [],
                              },
                            }
                          : {}),
                      },
                    ]
                  : []),
              ],
            },
          ],
          specificationProvider: {
            id: 'specification-openspec',
            store: { id: 'managed-blackbox', repositoryId: 'workspace' },
          },
          lifecycle: {
            skillBindings: {
              schemaVersion: 1,
              bindings: [
                {
                  id: 'team-design-method',
                  target: 'specification.plan',
                  role: 'augmentation-replacement',
                  skill: 'team-design-method',
                  slot: 'design-method',
                  order: 10,
                },
                {
                  id: 'team-build-guidance',
                  target: 'build.execute',
                  role: 'guidance',
                  skill: 'team-build-guidance',
                  order: 20,
                },
              ],
            },
          },
        }),
      );
      await execFileAsync('git', ['add', '.'], { cwd: workspace });
      await execFileAsync('git', ['commit', '-m', 'chore: configure managed execution'], {
        cwd: workspace,
      });
      await execFileAsync('git', ['push'], { cwd: workspace });

      if (!protectedWriteRepositories && !multiRepository) await prepareBuildBranches();
      const started = await runCli<RunStatusView>({
        packageRoot: productRoot,
        cwd: workspace,
        environment,
        args: [
          'run',
          'start',
          '--workspace',
          workspace,
          '--change',
          'managed-blackbox',
          '--target',
          'main',
          '--execution-mode',
          executionMode,
        ],
      });
      const runId = started.runId!;
      if (!protectedWriteRepositories && multiRepository) await prepareBuildBranches();
      const environmentKeys = [
        'XDG_DATA_HOME',
        'XDG_CONFIG_HOME',
        'OPENSPEC_NO_UPDATE_CHECK',
        'OPENSPEC_TELEMETRY',
      ] as const;
      const previousEnvironment = Object.fromEntries(
        environmentKeys.map((key) => [key, process.env[key]]),
      );
      for (const key of environmentKeys) process.env[key] = environment[key];
      let application = await bootProjectComposition(productRoot, workspace);
      try {
        let invalidConfigurationSubmitted = false;
        let correctedConfigurationResult: WorkExecutionResult | undefined;
        let invalidPlanSubmitted = false;
        let correctedPlanResult: WorkExecutionResult | undefined;
        let invalidCheckSubmitted = false;
        let correctedCheckResult: WorkExecutionResult | undefined;
        const installHost = () =>
          installCapturingWorkExecutionHost({
            context: application.context,
            workspace,
            repositories: { workspace, app: appRepository, worker: workerRepository },
            capabilities:
              executionMode === 'subagent-driven-development' ? ['subagent.dispatch.attested'] : [],
            operations(packet) {
              const roles = packet.context.layers
                .filter((layer) => ['action-skill', 'augmentation-skill'].includes(layer.kind))
                .map((layer) => [layer.skillRole, layer.source]);
              if (packet.work.kind === 'change.intake') {
                expect(roles).toEqual([
                  ['action', 'repoctopus-open-change'],
                  ['builtin-augmentation', 'grilling'],
                ]);
              }
              if (packet.work.kind === 'specification.plan') {
                expect(roles).toEqual([
                  ['action', 'repoctopus-design-change'],
                  ['team-replacement', 'team-design-method'],
                ]);
              }
              if (
                packet.work.kind === 'change.intake' ||
                packet.work.kind === 'specification.plan'
              ) {
                return [
                  {
                    repositoryId: 'workspace',
                    relativePath: 'openspec/changes/managed-blackbox/proposal.md',
                    artifactKind: 'proposal',
                    content:
                      '# Proposal\n\n## Why\n\nProve managed execution.\n\n## What Changes\n\n- Add managed behavior.\n\n## Capabilities\n\n### New Capabilities\n\n- `managed-demo`: add behavior.\n\n### Modified Capabilities\n\n## Impact\n\n- Runtime only.\n',
                  },
                  {
                    repositoryId: 'workspace',
                    relativePath: 'openspec/changes/managed-blackbox/design.md',
                    artifactKind: 'design',
                    content:
                      '# Design\n\n## Context\n\nManaged Host.\n\n## Goals / Non-Goals\n\n**Goals:**\n- Prove all phases.\n\n**Non-Goals:**\n- Vendor model APIs.\n\n## Decisions\n\nUse Runtime authority.\n',
                  },
                  {
                    repositoryId: 'workspace',
                    relativePath: 'openspec/changes/managed-blackbox/tasks.md',
                    artifactKind: 'tasks',
                    content:
                      '# Tasks\n\n- [ ] 1.1 Write the first managed output.\n  **Acceptance:** first output exists\n  **Requirements:** managed-demo#managed-execution\n- [ ] 1.2 Write the second managed output.\n  **Acceptance:** second output exists\n  **Requirements:** managed-demo#managed-execution\n',
                  },
                  {
                    repositoryId: 'workspace',
                    relativePath: 'openspec/changes/managed-blackbox/specs/managed-demo/spec.md',
                    artifactKind: 'delta-specs',
                    content:
                      '# Managed Demo Delta\n\n## Purpose\n\nProve that Runtime-authoritative Work execution delivers complete context to one managed Host before any guarded operation can produce completion evidence.\n\n## ADDED Requirements\n\n### Requirement: Managed execution\n\nThe Runtime MUST authorize every managed write.\n\n#### Scenario: Host writes\n\n- **WHEN** the Host receives a packet\n- **THEN** the guarded operation succeeds\n',
                  },
                ];
              }
              if (packet.work.kind === 'build.execute') {
                expect(roles.slice(0, 3)).toEqual([
                  ['action', 'repoctopus-build-execute'],
                  ['builtin-augmentation', 'tdd'],
                  ['team-guidance', 'team-build-guidance'],
                ]);
                expect(roles.slice(3)).toEqual(
                  packet.claim.attempt > 1 ? [[undefined, 'diagnosing-bugs']] : [],
                );
                const inputs = JSON.parse(
                  packet.context.layers.find((layer) => layer.kind === 'change-inputs')!.content,
                ) as { build: { currentPackage: { repositoryIds: string[] } } };
                const repositoryId = inputs.build.currentPackage.repositoryIds[0]!;
                return [
                  {
                    repositoryId,
                    relativePath: `src/managed-${packet.work.packageId!.replace(':', '-')}.txt`,
                    content: `managed package ${packet.work.packageId}\n`,
                  },
                ];
              }
              return [];
            },
            result(packet, session) {
              const inputs = JSON.parse(
                packet.context.layers.find((layer) => layer.kind === 'change-inputs')!.content,
              ) as {
                tasks: Array<{
                  taskId: string;
                  acceptanceCriteria: Array<{ acceptanceId: string }>;
                }>;
                build: {
                  strategy: {
                    semanticDigest: `sha256:${string}`;
                    tddMode: 'tdd' | 'direct';
                  };
                  binding: { stateDigest: `sha256:${string}` } | null;
                  plan: {
                    packages: Array<{
                      packageId: string;
                      taskIds: string[];
                      repositoryIds: string[];
                    }>;
                  } | null;
                  currentPackage: { packageId: string } | null;
                } | null;
              };
              if (packet.work.kind === 'build.configure') {
                const candidate = {
                  schemaVersion: 1,
                  kind: 'execution-binding-candidate',
                  strategyDigest: inputs.build!.strategy.semanticDigest,
                } satisfies WorkExecutionResult;
                correctedConfigurationResult = candidate;
                if (
                  !multiRepository &&
                  executionMode === 'autonomous' &&
                  !invalidConfigurationSubmitted
                ) {
                  invalidConfigurationSubmitted = true;
                  return {
                    ...candidate,
                    strategyDigest: `sha256:${'0'.repeat(64)}`,
                  };
                }
                return candidate;
              }
              if (packet.work.kind === 'build.plan') {
                const candidate = {
                  schemaVersion: 1,
                  kind: 'build-plan-candidate',
                  packages: inputs.tasks.map((task, index) => {
                    const repositoryId = multiRepository && index > 0 ? 'worker' : 'app';
                    return {
                      packageKey: task.taskId,
                      taskIds: [task.taskId],
                      repositoryIds: [repositoryId],
                      writeScopes: [{ repositoryId, paths: ['src/**'] }],
                      acceptanceRefs: task.acceptanceCriteria.map((entry) => entry.acceptanceId),
                      expectedOutcomes: [`Complete ${task.taskId}`],
                      validatorProfile: 'build.package-valid',
                      dependsOn: index === 0 ? [] : [inputs.tasks[index - 1]!.taskId],
                      sideEffectClass: 'repository-write' as const,
                      completionContract: {
                        schemaVersion: 1 as const,
                        behaviorSlice: task.taskId,
                        requiredEvidence:
                          inputs.build!.strategy.tddMode === 'tdd'
                            ? ([
                                'acceptance',
                                'implementation',
                                'red',
                                'green',
                                'regression',
                              ] as const)
                            : (['acceptance', 'implementation', 'test', 'regression'] as const),
                      },
                    };
                  }),
                } satisfies WorkExecutionResult;
                correctedPlanResult = candidate;
                if (!multiRepository && executionMode === 'autonomous' && !invalidPlanSubmitted) {
                  invalidPlanSubmitted = true;
                  return { ...candidate, packages: candidate.packages.slice(0, 1) };
                }
                return candidate;
              }
              if (packet.work.kind === 'build.execute') {
                return {
                  schemaVersion: 1,
                  kind: 'build-package-completion',
                  packageId: packet.work.packageId!,
                  acceptanceEvidenceIds: [`acceptance:${packet.work.packageId}`],
                  testEvidenceIds: [`test:${packet.work.packageId}`],
                  tddEvidence: {
                    redEvidenceId: `red:${packet.work.packageId}`,
                    greenEvidenceId: `green:${packet.work.packageId}`,
                    regressionEvidenceId: `regression:${packet.work.packageId}`,
                  },
                  implementationDigest: `sha256:${'e'.repeat(64)}`,
                };
              }
              if (packet.work.kind === 'build.check') {
                const candidate = {
                  schemaVersion: 1,
                  kind: 'build-check-candidate',
                  completedPackageIds: inputs.build!.plan!.packages.map((entry) => entry.packageId),
                  acceptedTaskIds: inputs.tasks.map((task) => task.taskId),
                  testEvidenceIds: ['test:build-check'],
                  implementationDigest: `sha256:${'f'.repeat(64)}`,
                  reviewerExecutionId: session.invocationId,
                } satisfies WorkExecutionResult;
                correctedCheckResult = candidate;
                if (!multiRepository && executionMode === 'autonomous' && !invalidCheckSubmitted) {
                  invalidCheckSubmitted = true;
                  return { ...candidate, reviewerExecutionId: 'review:wrong-invocation' };
                }
                return candidate;
              }
              return undefined;
            },
            delegationReceipts(packet, session) {
              if (
                executionMode !== 'subagent-driven-development' ||
                packet.work.kind !== 'build.execute' ||
                !packet.work.packageId
              ) {
                return [];
              }
              return [
                {
                  schemaVersion: 1,
                  receiptId: `${session.invocationId}:implementer`,
                  parentInvocationId: session.invocationId,
                  coordinatorHostId: 'capturing-work-execution-host',
                  executionId: `${session.invocationId}:subagent`,
                  role: 'implementer',
                  packageId: packet.work.packageId,
                  status: 'succeeded',
                  outcomeDigest: `sha256:${'9'.repeat(64)}`,
                },
              ];
            },
            async afterOperations(packet) {
              if (packet.work.kind === 'build.execute') {
                const inputs = JSON.parse(
                  packet.context.layers.find((layer) => layer.kind === 'change-inputs')!.content,
                ) as { build: { currentPackage: { repositoryIds: string[] } } };
                const repositoryId = inputs.build.currentPackage.repositoryIds[0]!;
                const checkout =
                  repositoryId === 'app'
                    ? appRepository
                    : repositoryId === 'worker'
                      ? workerRepository
                      : workspace;
                await execFileAsync('git', ['add', 'src'], { cwd: checkout });
                const status = await execFileAsync('git', ['status', '--porcelain'], {
                  cwd: checkout,
                });
                if (!status.stdout.trim()) return;
                await execFileAsync(
                  'git',
                  ['commit', '-m', `feat: complete ${packet.work.packageId}`],
                  { cwd: checkout },
                );
                await execFileAsync('git', ['push'], { cwd: checkout });
                return;
              }
              if (!['change.intake', 'specification.plan'].includes(packet.work.kind)) return;
              await execFileAsync('git', ['add', 'openspec/changes/managed-blackbox'], {
                cwd: workspace,
              });
              const status = await execFileAsync('git', ['status', '--porcelain'], {
                cwd: workspace,
              });
              if (!status.stdout.trim()) return;
              await execFileAsync(
                'git',
                ['commit', '-m', `spec: complete ${packet.work.phase} planning work`],
                { cwd: workspace },
              );
              await execFileAsync('git', ['push'], { cwd: workspace });
            },
          });
        let capture = installHost();
        const invocationKinds: string[] = [];
        const restartApplication = async () => {
          invocationKinds.push(...capture.invocations.map((item) => item.packet.work.kind));
          capture.dispose();
          await application.close();
          application = await bootProjectComposition(productRoot, workspace);
          capture = installHost();
        };
        const next = () =>
          application.context.commandRouter.execute<
            { runId: string },
            RuntimeResult<RunStatusView>
          >('run.next', { runId });
        const status = () =>
          application.context.commandRouter.execute<{ runId: string }, RunStatusView>(
            'run.status',
            {
              runId,
            },
          );
        const productionComposition = compositionIdentity(application.composition);
        const seedPreviousComposition = async (options: {
          label: string;
          pluginId: string;
          codeDigest: `sha256:${string}`;
          descriptorDigest: `sha256:${string}`;
        }) => {
          const store = new FileRuntimeStore(workspace);
          await store.commitGuarded(runId, ({ state, trajectory }) => {
            const timestamp = new Date().toISOString();
            const composition = structuredClone(productionComposition);
            composition.compositionDigest = `sha256:${options.label.padEnd(64, '0')}`;
            const plugin = composition.plugins.find((entry) => entry.id === options.pluginId);
            if (!plugin) throw new Error(`missing production plugin ${options.pluginId}`);
            plugin.codeDigest = options.codeDigest;
            plugin.descriptorDigest = options.descriptorDigest;
            const nextState = {
              ...state,
              composition,
              stateVersion: state.stateVersion + 1,
              updatedAt: timestamp,
            };
            return {
              state: nextState,
              event: {
                schemaVersion: 1 as const,
                sequence: trajectory.length + 1,
                eventId: `fixture:${options.label}:${state.stateVersion + 1}`,
                timestamp,
                type: 'run.resumed' as const,
                runId,
                stateVersion: nextState.stateVersion,
                compositionDigest: composition.compositionDigest,
                data: { fixture: 'production-cli-composition-predecessor', label: options.label },
              },
              value: undefined,
            };
          });
        };
        const restoreProductionComposition = async (label: string) => {
          const store = new FileRuntimeStore(workspace);
          await store.commitGuarded(runId, ({ state, trajectory }) => {
            const timestamp = new Date().toISOString();
            const nextState = {
              ...state,
              composition: structuredClone(productionComposition),
              stateVersion: state.stateVersion + 1,
              updatedAt: timestamp,
            };
            return {
              state: nextState,
              event: {
                schemaVersion: 1 as const,
                sequence: trajectory.length + 1,
                eventId: `fixture:${label}:${state.stateVersion + 1}`,
                timestamp,
                type: 'run.resumed' as const,
                runId,
                stateVersion: nextState.stateVersion,
                compositionDigest: productionComposition.compositionDigest,
                data: { fixture: 'restore-production-composition', label },
              },
              value: undefined,
            };
          });
        };

        expect((await next()).value).toMatchObject({
          changeLifecycle: { phase: 'open', currentWork: { kind: 'change.intake' } },
          continuation: { reason: 'validator-pending' },
        });
        if (!multiRepository && executionMode === 'autonomous') {
          const beforeRepair = await status();
          const originalWorkId = beforeRepair.changeLifecycle?.currentWork?.workId;
          await writeFile(
            path.join(workspace, 'openspec', 'changes', 'managed-blackbox', 'tasks.md'),
            '# Tasks\n\n- [ ] 1.1 Missing acceptance evidence.\n',
          );
          const repaired = (await next()).value;
          expect(repaired.state.workExecution).toBeUndefined();
          expect(repaired.changeLifecycle).toMatchObject({
            phase: 'open',
            status: 'running',
            currentWork: { kind: 'change.intake' },
            nextActions: [{ kind: 'work' }],
          });
          expect(repaired.changeLifecycle?.currentWork?.workId).not.toBe(originalWorkId);

          await next();
          const repairedOutcome = await status();
          const repairedInvocation = repairedOutcome.state.workExecution?.hostInvocation;
          expect(repairedOutcome.state.workExecution).toMatchObject({
            status: 'outcome',
            actionOutcome: { status: 'succeeded' },
          });
          if (!repairedInvocation) throw new Error('missing repaired Open invocation');
          const unavailable = vi
            .spyOn(application.context.specification, 'inspect')
            .mockRejectedValueOnce(new Error('simulated Provider outage'));
          const invocationCountBeforeReobserve = capture.invocations.length;
          const unavailableResult = await next();
          unavailable.mockRestore();
          expect(unavailableResult.value).toMatchObject({
            changeLifecycle: {
              phase: 'open',
              currentWork: { workId: repairedOutcome.changeLifecycle?.currentWork?.workId },
            },
            continuation: {
              continuation: 'reobserve',
              reason: 'open-observation-unavailable',
              observationStage: 'provider-validation',
            },
          });
          expect(unavailableResult.value.state.workExecution?.hostInvocation?.invocationId).toBe(
            repairedInvocation.invocationId,
          );
          const unavailableInspection = await application.context.commandRouter.execute<
            { runId: string },
            RunStoreInspection
          >('run.inspect', { runId });
          expect(
            [...unavailableInspection.trajectory]
              .reverse()
              .find((event) => event.type === 'continuation.selected'),
          ).toMatchObject({
            data: {
              continuation: 'reobserve',
              result: 'unavailable',
              reasonCode: 'open-observation-unavailable',
              hostReplayed: false,
            },
          });
          expect(capture.invocations).toHaveLength(invocationCountBeforeReobserve);

          const originalChangeBranch = application.context.project.changeBranch.bind(
            application.context.project,
          );
          const unavailableBranch = vi
            .spyOn(application.context.project, 'changeBranch')
            .mockRejectedValueOnce(new Error('simulated published branch timeout'))
            .mockImplementation(originalChangeBranch);
          const unavailableBranchResult = await next();
          unavailableBranch.mockRestore();
          expect(unavailableBranchResult.value).toMatchObject({
            changeLifecycle: {
              phase: 'open',
              currentWork: { workId: repairedOutcome.changeLifecycle?.currentWork?.workId },
            },
            state: { workExecution: { status: 'validated' } },
            continuation: {
              continuation: 'reobserve',
              reason: 'open-observation-unavailable',
              observationStage: 'planning-gate',
            },
          });
          expect(
            unavailableBranchResult.value.state.workExecution?.hostInvocation?.invocationId,
          ).toBe(repairedInvocation.invocationId);
          expect(capture.invocations).toHaveLength(invocationCountBeforeReobserve);

          const currentOpenSnapshot = await application.context.project.snapshot({
            workspaceId: 'managed-blackbox',
            workspaceRoot: workspace,
            workspaceRepositoryId: 'workspace',
            repositories: [
              { id: 'workspace', path: workspace },
              { id: 'app', path: appRepository },
            ],
          });
          const resumedOpen = await application.context.workflowRuns.resume({
            runId,
            currentProjectSnapshot: currentOpenSnapshot,
          });
          expect(resumedOpen.value).toMatchObject({
            reconciliation: {
              changeClass: 'content',
              requiresReconciliation: false,
            },
            execution: {
              continuation: 'reobserve',
              reason: 'open-gate-pending',
              observationStage: 'planning-gate',
            },
            state: { workExecution: { status: 'validated' } },
          });
          expect(resumedOpen.value.state.workExecution?.hostInvocation?.invocationId).toBe(
            repairedInvocation.invocationId,
          );
          expect(capture.invocations).toHaveLength(invocationCountBeforeReobserve);

          const identityCandidates = [
            createProjectSnapshot({
              ...currentOpenSnapshot,
              repositories: currentOpenSnapshot.repositories.map((repository) =>
                repository.id === 'workspace'
                  ? { ...repository, branch: 'different-branch' }
                  : repository,
              ),
            }),
            createProjectSnapshot({
              ...currentOpenSnapshot,
              repositories: currentOpenSnapshot.repositories.map((repository) =>
                repository.id === 'workspace'
                  ? { ...repository, remoteIdentity: 'example.com/other/workspace' }
                  : repository,
              ),
            }),
            createProjectSnapshot({
              ...currentOpenSnapshot,
              repositories: [
                ...currentOpenSnapshot.repositories,
                {
                  ...currentOpenSnapshot.repositories[0]!,
                  id: 'topology-added',
                  name: 'topology-added',
                },
              ],
            }),
          ];
          for (const candidate of identityCandidates) {
            expect(reconcileProjectSnapshots(currentOpenSnapshot, candidate)).toMatchObject({
              changeClass: 'identity',
              requiresReconciliation: true,
            });
          }

          const originalAssess = application.context.specificationPlanning.assess.bind(
            application.context.specificationPlanning,
          );
          const unavailablePlanning = vi
            .spyOn(application.context.specificationPlanning, 'assess')
            .mockRejectedValueOnce(new Error('simulated planning Provider timeout'))
            .mockImplementation(originalAssess);
          const unavailablePlanningResult = await next();
          unavailablePlanning.mockRestore();
          expect(unavailablePlanningResult.value).toMatchObject({
            changeLifecycle: {
              phase: 'open',
              currentWork: { workId: repairedOutcome.changeLifecycle?.currentWork?.workId },
            },
            state: { workExecution: { status: 'validated' } },
            continuation: {
              continuation: 'reobserve',
              reason: 'open-observation-unavailable',
              observationStage: 'planning-gate',
            },
          });
          expect(capture.invocations).toHaveLength(invocationCountBeforeReobserve);
        }
        const [observedOpen, duplicateOpen] = await Promise.all([next(), next()]);
        for (const observed of [observedOpen, duplicateOpen]) {
          expect(observed.value.changeLifecycle).toMatchObject({
            phase: 'open',
            status: 'waiting',
            currentWork: null,
            waitCondition: { kind: 'human-decision' },
          });
        }
        if (!multiRepository && executionMode === 'autonomous') {
          expect(
            capture.invocations.filter((item) => item.packet.work.kind === 'change.intake'),
          ).toHaveLength(2);
        }
        const openApproval = await application.context.commandRouter.execute<
          { changeId: string; approvalPhase: 'open' },
          SpecificationApprovalState | null
        >('specification.approval.status', {
          changeId: 'managed-blackbox',
          approvalPhase: 'open',
        });
        if (!openApproval || openApproval.status !== 'awaiting_approval') {
          throw new Error('missing Open approval');
        }
        await application.context.commandRouter.execute('run.change.decide', {
          runId,
          response: {
            apiVersion: 'repoctopus/v1alpha1',
            kind: 'HumanDecisionResponse',
            requestId: openApproval.decisionRequest.requestId,
            proposalHash: openApproval.decisionRequest.proposalHash,
            decision: 'approve',
          },
          actor: { actorId: 'managed-test-user', source: 'cli', authenticated: true },
          isolation: 'branch',
        });
        if (!multiRepository && executionMode === 'autonomous') {
          await writeFile(
            path.join(workspace, 'openspec', 'changes', 'managed-blackbox', 'tasks.md'),
            '# Tasks\n\n- [ ] 1.1 Write the changed managed output.\n  **Acceptance:** changed output exists\n  **Requirements:** managed-demo#managed-execution\n- [ ] 1.2 Write the second managed output.\n  **Acceptance:** second output exists\n  **Requirements:** managed-demo#managed-execution\n',
          );
          expect(
            await application.context.specificationPlanning.revalidateOpenApproval({
              changeId: 'managed-blackbox',
              approvalPhase: 'open',
              changeBranch: openApproval.snapshot.changeBranch,
              expectedSnapshotDigest: openApproval.snapshot.digest,
            }),
          ).toMatchObject({
            status: 'invalid',
            source: 'approval-drift',
            reasonCode: 'approval-drift',
          });
          const drifted = await next();
          expect(drifted.value.changeLifecycle).toMatchObject({
            phase: 'open',
            status: 'running',
            currentWork: { kind: 'change.intake' },
          });
          expect(drifted.value.state.workExecution).toBeUndefined();
          await next();
          const refreshedWait = await next();
          expect(refreshedWait.value.changeLifecycle).toMatchObject({
            phase: 'open',
            status: 'waiting',
            currentWork: null,
          });
          const refreshedApproval = await application.context.commandRouter.execute<
            { changeId: string; approvalPhase: 'open' },
            SpecificationApprovalState | null
          >('specification.approval.status', {
            changeId: 'managed-blackbox',
            approvalPhase: 'open',
          });
          if (!refreshedApproval || refreshedApproval.status !== 'awaiting_approval') {
            throw new Error('missing refreshed Open approval after drift');
          }
          expect(refreshedApproval.decisionRequest.requestId).not.toBe(
            openApproval.decisionRequest.requestId,
          );
          await application.context.commandRouter.execute('run.change.decide', {
            runId,
            response: {
              apiVersion: 'repoctopus/v1alpha1',
              kind: 'HumanDecisionResponse',
              requestId: refreshedApproval.decisionRequest.requestId,
              proposalHash: refreshedApproval.decisionRequest.proposalHash,
              decision: 'approve',
            },
            actor: { actorId: 'managed-test-user', source: 'cli', authenticated: true },
            isolation: 'branch',
          });
        }
        let designWork: RuntimeResult<RunStatusView>;
        if (!multiRepository && executionMode === 'autonomous') {
          const approvedOpenBeforeAdoption = await application.context.commandRouter.execute<
            { changeId: string; approvalPhase: 'open' },
            SpecificationApprovalState | null
          >('specification.approval.status', {
            changeId: 'managed-blackbox',
            approvalPhase: 'open',
          });
          if (!approvedOpenBeforeAdoption || approvedOpenBeforeAdoption.status !== 'approved') {
            throw new Error('missing approved Open request before compatible adoption');
          }
          invocationKinds.push(...capture.invocations.map((item) => item.packet.work.kind));
          capture.dispose();
          await application.close();
          await seedPreviousComposition({
            label: 'c1',
            pluginId: 'workflow-telemetry-otel',
            codeDigest: `sha256:${'1'.repeat(64)}`,
            descriptorDigest: `sha256:${'2'.repeat(64)}`,
          });
          const compatible = await runCli<RunStatusView>({
            packageRoot: productRoot,
            cwd: workspace,
            environment,
            args: ['run', 'next', '--workspace', workspace, '--run', runId],
          });
          if (!compatible.result) throw new Error('missing compatible CLI adoption result');
          designWork = { value: compatible.result, diagnostics: [] };
          const compatibleTrajectory = await new FileRuntimeStore(workspace).loadTrajectory(runId);
          expect(
            compatibleTrajectory.filter(
              (event) =>
                event.type === 'composition.changed' &&
                event.data.previousCompositionDigest === `sha256:${'c1'.padEnd(64, '0')}`,
            ),
          ).toHaveLength(1);

          application = await bootProjectComposition(productRoot, workspace);
          capture = installHost();
          const retainedOpenApproval = await application.context.commandRouter.execute<
            { changeId: string; approvalPhase: 'open' },
            SpecificationApprovalState | null
          >('specification.approval.status', {
            changeId: 'managed-blackbox',
            approvalPhase: 'open',
          });
          expect(retainedOpenApproval).toMatchObject({
            decisionRequest: { requestId: approvedOpenBeforeAdoption.decisionRequest.requestId },
          });

          invocationKinds.push(...capture.invocations.map((item) => item.packet.work.kind));
          capture.dispose();
          await application.close();
          await seedPreviousComposition({
            label: 'd1',
            pluginId: 'workflow-runs',
            codeDigest: `sha256:${'3'.repeat(64)}`,
            descriptorDigest: `sha256:${'4'.repeat(64)}`,
          });
          const beforeIncompatibleStatus = await new FileRuntimeStore(workspace).loadTrajectory(
            runId,
          );
          const incompatible = await runCli<RunStatusView>({
            packageRoot: productRoot,
            cwd: workspace,
            environment,
            args: ['run', 'status', '--workspace', workspace, '--run', runId],
          });
          expect(incompatible.result?.compositionCompatibility).toMatchObject({
            status: 'migration_required',
            changedPluginIds: ['workflow-runs'],
          });
          expect(await new FileRuntimeStore(workspace).loadTrajectory(runId)).toEqual(
            beforeIncompatibleStatus,
          );
          await restoreProductionComposition('d1');
          application = await bootProjectComposition(productRoot, workspace);
          capture = installHost();
        } else {
          designWork = await next();
        }
        expect(designWork.value.changeLifecycle).toMatchObject({
          phase: 'design',
          currentWork: { kind: 'specification.plan' },
          workspaceIntent: { schemaVersion: 2, isolation: 'branch' },
        });
        expect(designWork.value.changeLifecycle?.workspaceIntent).not.toHaveProperty(
          'targetBranch',
        );
        expect(designWork.value.state.trigger?.facts).toMatchObject({
          targetBranch: { targetBranch: 'main' },
          changeStartBinding: {
            sourceBranch: 'spec/managed-blackbox',
            targetBranch: 'main',
          },
        });
        const designWorkId = designWork.value.changeLifecycle?.currentWork?.workId;
        expect(designWorkId).toBeTruthy();
        await next();

        const originalChangeBranch = application.context.project.changeBranch.bind(
          application.context.project,
        );
        const transientDesignFailure = vi
          .spyOn(application.context.project, 'changeBranch')
          .mockRejectedValueOnce(new Error('simulated transient remote lookup failure'))
          .mockImplementation(originalChangeBranch);
        const blocked = await next();
        expect(blocked.value).toMatchObject({
          changeLifecycle: {
            phase: 'design',
            status: 'blocked',
            currentWork: null,
          },
          continuation: { reason: 'transition-pending' },
        });
        expect((await status()).state.workExecution).toBeUndefined();
        transientDesignFailure.mockRestore();

        if (!multiRepository && executionMode === 'autonomous') {
          const invalidPlan = structuredClone(
            await application.context.evidenceCoordinator.compile('verify'),
          );
          invalidPlan.nodes[0]!.covers = ['task:missing'];
          const compile = vi
            .spyOn(application.context.evidenceCoordinator, 'compile')
            .mockResolvedValue(invalidPlan);
          const plan = vi.spyOn(application.context.evidenceCoordinator, 'plan');
          const run = vi.spyOn(application.context.evidenceCoordinator, 'run');

          const coverageBlocked = await next();
          expect(coverageBlocked.value).toMatchObject({
            changeLifecycle: {
              phase: 'design',
              status: 'blocked',
              currentWork: null,
            },
            continuation: { reason: 'transition-pending' },
          });
          expect((await status()).state.workExecution).toBeUndefined();
          expect(compile).toHaveBeenCalledOnce();
          expect(plan).not.toHaveBeenCalled();
          expect(run).not.toHaveBeenCalled();
          expect(
            capture.invocations.some((item) => item.packet.work.kind.startsWith('build.')),
          ).toBe(false);
          expect(
            (await application.context.specification.tasks('managed-blackbox')).tasks.every(
              (task) => task.status === 'pending' && task.completion === null,
            ),
          ).toBe(true);
          let evidenceAttempts: string[] = [];
          try {
            evidenceAttempts = await readdir(
              path.join(workspace, '.repoctopus', 'evidence', 'runs'),
            );
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
          expect(evidenceAttempts).toHaveLength(0);
          expect(
            await application.context.commandRouter.execute<
              { changeId: string; approvalPhase: 'design' },
              SpecificationApprovalState | null
            >('specification.approval.status', {
              changeId: 'managed-blackbox',
              approvalPhase: 'design',
            }),
          ).toBeNull();
          compile.mockRestore();
          plan.mockRestore();
          run.mockRestore();
        }

        const waiting = await next();
        expect(waiting.value.changeLifecycle).toMatchObject({ phase: 'design', status: 'waiting' });
        expect((await status()).state.workExecution).toBeUndefined();
        const approval = await application.context.commandRouter.execute<
          { changeId: string },
          SpecificationApprovalState | null
        >('specification.approval.status', { changeId: 'managed-blackbox' });
        if (!approval || approval.status !== 'awaiting_approval')
          throw new Error('missing approval');
        await application.context.commandRouter.execute('run.change.decide', {
          runId,
          response: {
            apiVersion: 'repoctopus/v1alpha1',
            kind: 'HumanDecisionResponse',
            requestId: approval.decisionRequest.requestId,
            proposalHash: approval.decisionRequest.proposalHash,
            decision: 'approve',
          },
          actor: { actorId: 'managed-test-user', source: 'cli', authenticated: true },
        });
        expect((await next()).value.changeLifecycle).toMatchObject({
          phase: 'build',
          currentWork: { kind: 'build.configure' },
        });
        await next();
        const configurationInvocation = capture.invocations.findLast(
          (entry) => entry.packet.work.kind === 'build.configure',
        );
        invocationKinds.push(...capture.invocations.map((item) => item.packet.work.kind));
        capture.dispose();
        await application.close();
        application = await bootProjectComposition(productRoot, workspace);
        if (!multiRepository && executionMode === 'autonomous') {
          if (!configurationInvocation || !correctedConfigurationResult) {
            throw new Error('missing captured Build Configuration correction context');
          }
          const rejectedConfiguration = (await status()).state.workExecution;
          expect(rejectedConfiguration).toMatchObject({
            workId: configurationInvocation.packet.work.workId,
            attempt: configurationInvocation.packet.claim.attempt,
            checkEpoch: configurationInvocation.packet.claim.checkEpoch,
            status: 'invoking',
            continuation: 'awaiting-correction',
            pendingSubmission: null,
            rejectedSubmissions: [{ rejection: { reasonCode: 'outcome-rejected' } }],
          });
          expect(rejectedConfiguration?.acceptedSubmission).toBeUndefined();
          expect(rejectedConfiguration?.hostOutcome).toBeUndefined();
          expect(rejectedConfiguration?.actionOutcome).toBeUndefined();
          expect(rejectedConfiguration?.receiptId).toBeUndefined();
          expect(rejectedConfiguration?.hostInvocation).toMatchObject({
            invocationId: configurationInvocation.session.invocationId,
            packet: {
              packetDigest: configurationInvocation.session.packetDigest,
            },
          });
          const correction = {
            schemaVersion: 3,
            runId,
            submissionId: 'corrected-execution-binding-1',
            invocationId: configurationInvocation.session.invocationId,
            hostId: 'capturing-work-execution-host',
            packetDigest: configurationInvocation.session.packetDigest,
            status: 'succeeded',
            summary: 'Corrected Execution Binding reports the current machine observation',
            consumedLayerDigests: configurationInvocation.packet.context.layers
              .filter((layer) => ['action-skill', 'augmentation-skill'].includes(layer.kind))
              .map((layer) => layer.digest),
            result: correctedConfigurationResult,
          } as const;
          const malformed = {
            ...correction,
            submissionId: 'invalid-execution-binding-envelope',
            status: ['succeeded'] as unknown as 'succeeded',
          };
          const runStore = application.context.runStore;
          const commitGuarded = runStore.commitGuarded.bind(runStore);
          const interruption = vi
            .spyOn(runStore, 'commitGuarded')
            .mockImplementation(async (id, operation) => {
              let wroteSubmission = false;
              const value = await commitGuarded(id, async (current) => {
                const committed = await operation(current);
                wroteSubmission = committed.event?.data.submissionId === malformed.submissionId;
                return committed;
              });
              if (wroteSubmission) throw new Error('simulated exit after malformed Host commit');
              return value;
            });
          try {
            await expect(
              application.context.managedWorkExecutor.acceptExternalOutcome(malformed),
            ).rejects.toThrow('simulated exit after malformed Host commit');
          } finally {
            interruption.mockRestore();
          }
          await application.close();
          application = await bootProjectComposition(productRoot, workspace);
          await next();
          const recovered = (await status()).state.workExecution;
          expect(recovered).toMatchObject({
            workId: rejectedConfiguration?.workId,
            intentId: rejectedConfiguration?.intentId,
            claimToken: rejectedConfiguration?.claimToken,
            attempt: rejectedConfiguration?.attempt,
            checkEpoch: rejectedConfiguration?.checkEpoch,
            hostInvocation: rejectedConfiguration?.hostInvocation,
            status: 'invoking',
            continuation: 'awaiting-correction',
            pendingSubmission: null,
          });
          expect(recovered?.rejectedSubmissions?.at(-1)).toMatchObject({
            submissionId: malformed.submissionId,
            rawPayload: malformed,
            rejection: { reasonCode: 'output-invalid' },
          });
          expect(recovered?.actionOutcome).toBeUndefined();
          expect(recovered?.receiptId).toBeUndefined();
          const executor = application.context.managedWorkExecutor;
          const replayed = await executor.acceptExternalOutcome(malformed);
          expect(replayed.hostOutcome).toEqual(recovered?.rejectedSubmissions?.at(-1)?.outcome);
          await expect(
            executor.acceptExternalOutcome({ ...malformed, summary: 'Changed rejected payload' }),
          ).rejects.toThrow(/submission identity conflict/u);
          expect((await status()).state.workExecution?.rejectedSubmissions).toEqual(
            recovered?.rejectedSubmissions,
          );
          const persisted = createWorkExecutionSubmission(
            'persisted-invalid-envelope',
            replayed.hostOutcome!,
            { ...malformed, submissionId: 'persisted-invalid-envelope' },
          );
          await application.context.runStore.commitGuarded(runId, ({ state, trajectory }) => {
            if (!state.workExecution) throw new Error('missing persisted Host invocation');
            const timestamp = new Date().toISOString();
            const stateVersion = state.stateVersion + 1;
            return {
              state: {
                ...state,
                stateVersion,
                updatedAt: timestamp,
                workExecution: {
                  ...state.workExecution,
                  status: 'submitted',
                  continuation: 'execute',
                  pendingSubmission: persisted,
                  updatedAt: timestamp,
                },
              },
              event: {
                schemaVersion: 1,
                sequence: trajectory.length + 1,
                eventId: 'fixture:persisted-invalid-envelope',
                timestamp,
                type: 'work.host-completed',
                runId,
                stateVersion,
                compositionDigest: state.composition.compositionDigest,
                data: { submissionId: persisted.submissionId },
              },
              value: undefined,
            };
          });
          await application.close();
          application = await bootProjectComposition(productRoot, workspace);
          await next();
          const repaired = (await status()).state.workExecution;
          expect(repaired).toMatchObject({
            hostInvocation: recovered?.hostInvocation,
            status: 'invoking',
            continuation: 'awaiting-correction',
            pendingSubmission: null,
          });
          expect(repaired?.rejectedSubmissions?.at(-1)).toMatchObject({
            ...persisted,
            rejection: { reasonCode: 'output-invalid' },
          });
          expect(repaired?.receiptId).toBeUndefined();

          const restartedExecutor = application.context.managedWorkExecutor;
          await restartedExecutor.acceptExternalOutcome(correction);
          await restartedExecutor.acceptExternalOutcome(correction);
          const pending = (await status()).state.workExecution?.pendingSubmission;
          expect(pending?.submissionId).toBe(correction.submissionId);
          await expect(
            restartedExecutor.acceptExternalOutcome({
              ...malformed,
              submissionId: 'other-malformed-envelope',
            }),
          ).rejects.toThrow(/cannot be recorded from submitted/u);
          expect((await status()).state.workExecution?.pendingSubmission).toEqual(pending);
        }
        const planned = await next();
        if (!multiRepository && executionMode === 'autonomous') {
          const events = await application.context.runStore.loadTrajectory(runId);
          expect(
            events
              .filter((event) => event.data.submissionId === 'invalid-execution-binding-envelope')
              .map((event) => event.type),
          ).toEqual(['work.outcome-rejected']);
          expect(
            events.filter(
              (event) =>
                event.type === 'work.outcome-accepted' &&
                event.data.submissionId === 'corrected-execution-binding-1',
            ),
          ).toHaveLength(1);
        }
        capture = installHost();
        expect(planned.value.changeLifecycle).toMatchObject({
          phase: 'build',
          status: 'running',
          currentWork: { kind: 'build.plan' },
          waitCondition: null,
          build: { action: 'plan' },
        });
        if (multiRepository && executionMode === 'autonomous') {
          await writeFile(
            path.join(workspace, 'publication-marker.txt'),
            'Publication-only source OID update.\n',
          );
          await execFileAsync('git', ['add', 'publication-marker.txt'], { cwd: workspace });
          await execFileAsync('git', ['commit', '-m', 'chore: advance specification publication'], {
            cwd: workspace,
          });
          await execFileAsync('git', ['push'], { cwd: workspace });
          invocationKinds.push(...capture.invocations.map((item) => item.packet.work.kind));
          capture.dispose();
          await application.close();
          const publicationOnly = await runCli<RunStatusView>({
            packageRoot: productRoot,
            cwd: workspace,
            environment,
            args: ['run', 'status', '--workspace', workspace, '--run', runId],
          });
          expect(publicationOnly.result?.specificationCompatibility).toMatchObject({
            status: 'same',
          });
          expect(publicationOnly.result?.changeLifecycle).toMatchObject({
            phase: 'build',
            status: 'running',
            currentWork: { kind: 'build.plan' },
            waitCondition: null,
          });
          expect(publicationOnly.result?.changeLifecycle?.phase).not.toBe('design');
          application = await bootProjectComposition(productRoot, workspace);
          capture = installHost();
          const retainedDesignApproval = await application.context.commandRouter.execute<
            { changeId: string },
            SpecificationApprovalState | null
          >('specification.approval.status', { changeId: 'managed-blackbox' });
          expect(retainedDesignApproval).toMatchObject({
            decisionRequest: { requestId: approval.decisionRequest.requestId },
          });
          if (!protectedWriteRepositories) {
            const tasksPath = path.join(
              workspace,
              'openspec',
              'changes',
              'managed-blackbox',
              'tasks.md',
            );
            const acceptedTasks = await readFile(tasksPath, 'utf8');
            const originalPlanWork = (await status()).changeLifecycle!.currentWork!.workId;
            const invocationCount = capture.invocations.length;
            await writeFile(tasksPath, `${acceptedTasks}\n- [ ] 9.9 Unapproved planning change\n`);
            await execFileAsync('git', ['switch', '-c', 'unrelated/planning-and-branch'], {
              cwd: workerRepository,
            });
            const blockedPlanning = await next();
            expect(blockedPlanning.value.state.reconciliationRequired).toBe(true);
            expect(blockedPlanning.value.changeLifecycle?.currentWork?.workId).toBe(
              originalPlanWork,
            );
            expect(capture.invocations).toHaveLength(invocationCount);
            await writeFile(tasksPath, acceptedTasks);
            await execFileAsync('git', ['switch', 'feature/managed-blackbox'], {
              cwd: workerRepository,
            });
          }
        }
        await restartApplication();
        let planInvocation: (typeof capture.invocations)[number] | undefined;
        let planDispatchResult: RuntimeResult<RunStatusView> | undefined;
        for (let step = 0; step < 6 && !planInvocation; step += 1) {
          const advanced = await next();
          planInvocation = capture.invocations.findLast(
            (entry) => entry.packet.work.kind === 'build.plan',
          );
          if (planInvocation) {
            planDispatchResult = advanced;
          } else {
            expect(advanced.value.changeLifecycle?.waitCondition).toBeNull();
          }
        }
        if (!planDispatchResult) throw new Error('Build Plan was not dispatched');
        invocationKinds.push(...capture.invocations.map((item) => item.packet.work.kind));
        capture.dispose();
        await application.close();
        application = await bootProjectComposition(productRoot, workspace);
        let afterPlanValidation = planDispatchResult;
        if (protectedWriteRepositories) {
          const rejected = await status();
          expect(rejected.state.workExecution).toMatchObject({
            workId: planInvocation?.packet.work.workId,
            status: 'invoking',
            continuation: 'awaiting-correction',
            pendingSubmission: null,
            rejectedSubmissions: [{ rejection: { reasonCode: 'outcome-rejected' } }],
          });
          expect(afterPlanValidation.diagnostics).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ code: 'change.build-plan-protected-branch' }),
            ]),
          );
          expect(rejected.state.workExecution?.actionOutcome).toBeUndefined();
          expect(rejected.changeLifecycle).toMatchObject({
            phase: 'build',
            currentWork: { kind: 'build.plan' },
            build: { action: 'plan', planId: null },
          });
          expect(
            capture.invocations.some(
              (invocation) => invocation.packet.work.kind === 'build.execute',
            ),
          ).toBe(false);
          expect(
            (await application.context.specification.tasks('managed-blackbox')).tasks.every(
              (task) => task.status === 'pending' && task.completion === null,
            ),
          ).toBe(true);
          const inspection = await application.context.commandRouter.execute<
            { runId: string },
            RunStoreInspection
          >('run.inspect', { runId });
          expect(
            inspection.trajectory.findLast((event) => event.type === 'work.outcome-rejected'),
          ).toMatchObject({
            data: {
              workKind: 'build.plan',
              reasonCode: 'outcome-rejected',
              continuation: 'awaiting-correction',
            },
          });
          for (const repository of [appRepository, workerRepository]) {
            await execFileAsync('git', ['switch', '-c', 'feature/protected-write-recovery'], {
              cwd: repository,
            });
            await execFileAsync(
              'git',
              ['push', '--set-upstream', 'origin', 'feature/protected-write-recovery'],
              { cwd: repository },
            );
          }
          await restartApplication();
          const correctedSnapshot = await application.context.project.snapshot({
            workspaceId: 'managed-blackbox',
            workspaceRoot: workspace,
            workspaceRepositoryId: 'workspace',
            repositories: [
              { id: 'workspace', path: workspace },
              { id: 'app', path: appRepository },
              { id: 'worker', path: workerRepository },
            ],
          });
          if (prepoisonedProtectedRecovery) {
            const previousRuntime = new WorkflowRunCoordinator(
              new FileRuntimeStore(workspace),
              { async export() {} },
              productionComposition,
            );
            const poisoned = await previousRuntime.resume({
              runId,
              currentProjectSnapshot: correctedSnapshot,
            });
            expect(poisoned.value).toMatchObject({
              state: { reconciliationRequired: true },
              changeLifecycle: {
                phase: 'build',
                currentWork: { kind: 'build.plan' },
              },
            });
          }
          const recovered = await application.context.workflowRuns.resume({
            runId,
            currentProjectSnapshot: correctedSnapshot,
          });
          expect(recovered.value).toMatchObject({
            reconciliation: {
              changeClass: 'identity',
              requiresReconciliation: false,
            },
            state: { reconciliationRequired: false },
            changeLifecycle: {
              phase: 'build',
              currentWork: { kind: 'build.configure' },
              build: { action: 'configure', planId: null },
            },
          });
          expect(recovered.value.state.workExecution).toBeUndefined();
          const configureWorkId = recovered.value.changeLifecycle?.currentWork?.workId;
          const replayedRecovery = await application.context.workflowRuns.resume({
            runId,
            currentProjectSnapshot: correctedSnapshot,
          });
          expect(replayedRecovery.value).toMatchObject({
            state: { reconciliationRequired: false },
            changeLifecycle: {
              phase: 'build',
              currentWork: { kind: 'build.configure', workId: configureWorkId },
            },
          });
          const recoveredInspection = await application.context.commandRouter.execute<
            { runId: string },
            RunStoreInspection
          >('run.inspect', { runId });
          expect(
            recoveredInspection.trajectory.findLast(
              (event) => event.type === 'change.lifecycle.transitioned',
            ),
          ).toMatchObject({
            data: {
              changeLifecycleTransition: {
                transitionId: 'build.binding-revalidation-required',
              },
            },
          });
          expect(
            recoveredInspection.trajectory.filter(
              (event) =>
                event.type === 'change.lifecycle.transitioned' &&
                (event.data.authorizedBranchRebind as { result?: unknown } | undefined)?.result ===
                  'dispatched',
            ),
          ).toHaveLength(1);
          await execFileAsync('git', ['switch', '-c', 'unrelated/resume-drift'], {
            cwd: workspace,
          });
          const unrelatedSnapshot = await application.context.project.snapshot({
            workspaceId: 'managed-blackbox',
            workspaceRoot: workspace,
            workspaceRepositoryId: 'workspace',
            repositories: [
              { id: 'workspace', path: workspace },
              { id: 'app', path: appRepository },
              { id: 'worker', path: workerRepository },
            ],
          });
          const unrelatedResume = await application.context.workflowRuns.resume({
            runId,
            currentProjectSnapshot: unrelatedSnapshot,
          });
          expect(unrelatedResume.value).toMatchObject({
            state: { reconciliationRequired: true },
            changeLifecycle: {
              phase: 'build',
              currentWork: { kind: 'build.configure', workId: configureWorkId },
            },
          });
          capture.dispose();
          await application.close();
          return;
        }
        if (!multiRepository && executionMode === 'autonomous') {
          if (!planInvocation || !correctedPlanResult) {
            throw new Error('missing captured Build Plan correction context');
          }
          const rejected = await status();
          expect(rejected.state.workExecution).toMatchObject({
            workId: planInvocation.packet.work.workId,
            attempt: planInvocation.packet.claim.attempt,
            checkEpoch: planInvocation.packet.claim.checkEpoch,
            status: 'invoking',
            continuation: 'awaiting-correction',
            pendingSubmission: null,
            rejectedSubmissions: [{ rejection: { reasonCode: 'outcome-rejected' } }],
          });
          expect(rejected.state.workExecution?.actionOutcome).toBeUndefined();
          expect(rejected.changeLifecycle?.build?.planId).toBeNull();
          await application.context.managedWorkExecutor.acceptExternalOutcome({
            schemaVersion: 3,
            runId,
            submissionId: 'corrected-build-plan-1',
            invocationId: planInvocation.session.invocationId,
            hostId: 'capturing-work-execution-host',
            packetDigest: planInvocation.session.packetDigest,
            status: 'succeeded',
            summary: 'Corrected Build Plan covers every authoritative Task',
            consumedLayerDigests: planInvocation.packet.context.layers
              .filter((layer) => ['action-skill', 'augmentation-skill'].includes(layer.kind))
              .map((layer) => layer.digest),
            result: correctedPlanResult,
          });
          const planCoordinator = Reflect.get(application.context.workflowRuns, 'coordinator') as {
            acceptChangeObservation: (...args: unknown[]) => Promise<unknown>;
          };
          const planProjectionInterruption = vi
            .spyOn(planCoordinator, 'acceptChangeObservation')
            .mockRejectedValueOnce(
              new Error('simulated interruption after Plan Outcome validation'),
            );
          await expect(next()).rejects.toThrow(
            'simulated interruption after Plan Outcome validation',
          );
          planProjectionInterruption.mockRestore();
          expect((await status()).state.workExecution).toMatchObject({
            workId: planInvocation.packet.work.workId,
            status: 'validated',
            acceptedSubmission: { submissionId: 'corrected-build-plan-1' },
          });
          afterPlanValidation = await next();
          const accepted = await status();
          expect(accepted.state.workExecution).toBeUndefined();
        }
        capture = installHost();
        let afterPlan: RunStatusView;
        if (multiRepository) {
          expect(afterPlanValidation.value.changeLifecycle).toMatchObject({
            phase: 'build',
            status: 'waiting',
            currentWork: null,
            waitCondition: { kind: 'human-decision' },
            build: { action: 'plan-evidence', planRevision: 1 },
          });
          const planDecision = afterPlanValidation.value.changeLifecycle!.waitCondition!;
          if (planDecision.kind !== 'human-decision') {
            throw new Error('missing high-risk Build Plan decision');
          }
          await restartApplication();
          afterPlan = await application.context.commandRouter.execute<
            Parameters<typeof application.context.workflowRuns.decideChange>[0],
            RunStatusView
          >('run.change.decide', {
            runId,
            response: {
              apiVersion: 'repoctopus/v1alpha1',
              kind: 'HumanDecisionResponse',
              requestId: planDecision.requestId,
              proposalHash: planDecision.proposalDigest,
              decision: 'approve',
            },
            actor: { actorId: 'managed-test-user', source: 'cli', authenticated: true },
          });
        } else {
          afterPlan = afterPlanValidation.value;
          await restartApplication();
        }
        expect(afterPlan.changeLifecycle).toMatchObject({
          phase: 'build',
          currentWork: { kind: 'build.execute' },
          build: { action: 'execute', planRevision: 1 },
        });
        if (multiRepository && executionMode === 'autonomous' && !protectedWriteRepositories) {
          const beforeRace = await status();
          const bind = application.context.executionWorkspace.bind.bind(
            application.context.executionWorkspace,
          );
          let observations = 0;
          const lateBranch = vi
            .spyOn(application.context.executionWorkspace, 'bind')
            .mockImplementation(async (input) => {
              const observed = await bind(input);
              observations += 1;
              if (observations === 1)
                await execFileAsync('git', ['switch', '-c', 'unrelated/before-claim'], {
                  cwd: workerRepository,
                });
              return observed;
            });
          let blockedRace: RuntimeResult<RunStatusView>;
          try {
            blockedRace = await next();
          } finally {
            lateBranch.mockRestore();
          }
          expect(blockedRace.value.state.reconciliationRequired).toBe(true);
          expect(blockedRace.value.state.changeLifecycle?.buildProtocol).toEqual(
            beforeRace.state.changeLifecycle?.buildProtocol,
          );
          expect(capture.invocations).toHaveLength(0);
          await execFileAsync('git', ['switch', 'feature/managed-blackbox'], {
            cwd: workerRepository,
          });

          const host = application.context.workExecutionHosts.get('capturing-work-execution-host');
          if (!host) throw new Error('Missing package Host for the execution race');
          const invoke = host.invoke.bind(host);
          const interruptedHost = vi
            .spyOn(host, 'invoke')
            .mockImplementationOnce(async (packet, session) => {
              const outcome = await invoke(packet, session);
              await execFileAsync('git', ['switch', '-c', 'unrelated/after-host'], {
                cwd: workerRepository,
              });
              return outcome;
            });
          let blockedOutcome: RuntimeResult<RunStatusView>;
          try {
            blockedOutcome = await next();
          } finally {
            interruptedHost.mockRestore();
          }
          expect(blockedOutcome.value.state.reconciliationRequired).toBe(true);
          expect(blockedOutcome.value.state.changeLifecycle?.buildProtocol).toEqual(
            beforeRace.state.changeLifecycle?.buildProtocol,
          );
          expect(blockedOutcome.value.state.workExecution?.hostInvocation).toBeDefined();
          expect(blockedOutcome.value.state.workExecution?.pendingSubmission).toBeDefined();
          expect(capture.invocations).toHaveLength(1);
          await execFileAsync('git', ['switch', 'feature/managed-blackbox'], {
            cwd: workerRepository,
          });
        }
        let afterFirstPackage: RunStatusView;
        let afterFirstPackageDiagnostics: RuntimeResult<RunStatusView>['diagnostics'] = [];
        let afterAllPackages: RuntimeResult<RunStatusView>;
        if (!multiRepository && executionMode === 'autonomous') {
          const successAcceptanceInterruption = vi
            .spyOn(application.context.workDispatcher, 'acceptValidatedOutcome')
            .mockRejectedValueOnce(
              new Error('simulated interruption after external package submission'),
            );
          await expect(next()).rejects.toThrow(
            'simulated interruption after external package submission',
          );
          successAcceptanceInterruption.mockRestore();
          expect((await status()).state.workExecution).toMatchObject({
            status: 'submitted',
            pendingSubmission: { outcome: { status: 'succeeded' } },
          });

          await restartApplication();
          const packageCoordinator = Reflect.get(
            application.context.workflowRuns,
            'coordinator',
          ) as {
            acceptChangeObservation: (...args: unknown[]) => Promise<unknown>;
          };
          const packageProjectionInterruption = vi
            .spyOn(packageCoordinator, 'acceptChangeObservation')
            .mockRejectedValueOnce(
              new Error('simulated interruption after package Outcome validation'),
            );
          await expect(next()).rejects.toThrow(
            'simulated interruption after package Outcome validation',
          );
          packageProjectionInterruption.mockRestore();
          expect((await status()).state.workExecution).toMatchObject({
            status: 'validated',
            acceptedSubmission: { outcome: { status: 'succeeded' } },
            validatorId: 'build.package-valid',
          });
          const nextWorkPersistenceInterruption = vi
            .spyOn(application.context.workExecutionAuthority, 'recordWorkCreated')
            .mockRejectedValueOnce(
              new Error('simulated interruption after next package transition'),
            );
          await expect(next()).rejects.toThrow(
            'simulated interruption after next package transition',
          );
          nextWorkPersistenceInterruption.mockRestore();
          afterFirstPackage = await status();
          expect(afterFirstPackage.state.workExecution).toBeUndefined();

          await restartApplication();

          const packageHost = application.context.workExecutionHosts.get(
            'capturing-work-execution-host',
          );
          if (!packageHost) throw new Error('missing managed package Host');
          const failedInvocation = vi
            .spyOn(packageHost, 'invoke')
            .mockImplementationOnce((packet, session) =>
              Promise.resolve({
                schemaVersion: 1,
                invocationId: session.invocationId,
                hostId: packageHost.identity.id,
                packetDigest: packet.identity.packetDigest,
                status: 'failed',
                summary: 'simulated implementation finding from an external package Runner',
                consumedLayerDigests: packet.context.layers
                  .filter((layer) => ['action-skill', 'augmentation-skill'].includes(layer.kind))
                  .map((layer) => layer.digest),
                findings: [
                  {
                    kind: 'implementation_failure',
                    code: 'implementation-failed',
                    summary: 'retry the bounded package without revising Design',
                    taskIds: ['1.2'],
                    requirementIds: ['managed-demo#managed-execution'],
                  },
                ],
                completedAt: new Date().toISOString(),
              }),
            );
          const failureAcceptanceInterruption = vi
            .spyOn(application.context.workDispatcher, 'acceptOutcome')
            .mockRejectedValueOnce(
              new Error('simulated interruption after failed external package submission'),
            );
          await expect(next()).rejects.toThrow(
            'simulated interruption after failed external package submission',
          );
          failedInvocation.mockRestore();
          failureAcceptanceInterruption.mockRestore();
          expect((await status()).state.workExecution).toMatchObject({
            status: 'submitted',
            pendingSubmission: {
              outcome: {
                status: 'failed',
                findings: [{ kind: 'implementation_failure' }],
              },
            },
          });

          await restartApplication();
          const acceptedFailure = await next();
          expect(acceptedFailure.diagnostics).toContainEqual(
            expect.objectContaining({ code: 'change.work-failure-accepted' }),
          );
          expect((await status()).state.workExecution).toMatchObject({
            status: 'outcome',
            actionOutcome: { status: 'failed' },
            hostOutcome: {
              status: 'failed',
              findings: [{ kind: 'implementation_failure' }],
            },
          });
          await next();
          afterAllPackages = await next();
        } else {
          const firstPackageResult = await next();
          afterFirstPackage = firstPackageResult.value;
          afterFirstPackageDiagnostics = firstPackageResult.diagnostics;
          if (multiRepository && !protectedWriteRepositories) {
            const acceptedProtocol = afterFirstPackage.state.changeLifecycle!.buildProtocol!;
            const acceptedWork = afterFirstPackage.changeLifecycle!.currentWork!.workId;
            expect(acceptedProtocol.packageCompletions).toHaveLength(1);
            invocationKinds.push(...capture.invocations.map((item) => item.packet.work.kind));
            capture.dispose();
            await application.close();
            const commands =
              executionMode === 'autonomous' ? ['resume', 'next'] : ['next', 'resume'];
            const recover = (command: string) =>
              runCli<ResumeView>({
                packageRoot: productRoot,
                cwd: workspace,
                environment,
                args: ['run', command, '--workspace', workspace, '--run', runId],
              });
            const assertPreserved = (view: RunStatusView) => {
              expect(view.state.runId).toBe(runId);
              expect(view.changeLifecycle?.currentWork?.workId).toBe(acceptedWork);
              const protocol = view.state.changeLifecycle!.buildProtocol!;
              expect(protocol.binding).toEqual(acceptedProtocol.binding);
              expect(protocol.plan).toEqual(acceptedProtocol.plan);
              expect(protocol.packageCompletions).toEqual(acceptedProtocol.packageCompletions);
              expect(protocol.workspaceCheckpoint).toEqual(acceptedProtocol.workspaceCheckpoint);
            };
            for (const command of commands) {
              const recovered = await recover(command);
              assertPreserved(recovered.result!);
              expect(recovered.result!.state.reconciliationRequired).toBe(false);
              expect(recovered.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
                'runtime.project-changed',
              );
            }
            await execFileAsync('git', ['switch', '-c', 'unrelated/cold-build-recovery'], {
              cwd: workerRepository,
            });
            for (const command of [...commands, ...commands]) {
              const blocked = await recover(command);
              assertPreserved(blocked.result!);
              expect(blocked.result!.state.reconciliationRequired).toBe(true);
              expect(blocked.result!.continuation?.continuation).toBe('reconcile');
            }
            await execFileAsync('git', ['switch', 'feature/managed-blackbox'], {
              cwd: workerRepository,
            });
            for (const command of commands) {
              const recovered = await recover(command);
              assertPreserved(recovered.result!);
              expect(recovered.result!.state.reconciliationRequired).toBe(false);
            }
            application = await bootProjectComposition(productRoot, workspace);
            capture = installHost();
          }
          await restartApplication();
          afterAllPackages = await next();
        }
        for (
          let step = 0;
          step < 4 && afterAllPackages.value.changeLifecycle?.currentWork?.kind !== 'build.check';
          step += 1
        ) {
          afterAllPackages = await next();
        }
        expect(
          afterFirstPackage.changeLifecycle,
          JSON.stringify(afterFirstPackageDiagnostics),
        ).toMatchObject({
          phase: 'build',
          currentWork: { kind: 'build.execute' },
          taskProgress: { completed: 1 },
        });
        expect(
          afterAllPackages.value.changeLifecycle,
          JSON.stringify(afterAllPackages.diagnostics),
        ).toMatchObject({
          phase: 'build',
          currentWork: { kind: 'build.check' },
          taskProgress: { completed: 2 },
        });
        await restartApplication();
        let checkInvocation: (typeof capture.invocations)[number] | undefined;
        let checkDispatchResult: RuntimeResult<RunStatusView> | undefined;
        for (let step = 0; step < 8 && !checkInvocation; step += 1) {
          const advanced = await next();
          expect(advanced.value.changeLifecycle?.waitCondition).toBeNull();
          checkInvocation = capture.invocations.findLast(
            (entry) => entry.packet.work.kind === 'build.check',
          );
          if (checkInvocation) checkDispatchResult = advanced;
        }
        if (!checkDispatchResult) throw new Error('Build Check was not dispatched');
        let afterCheck = checkDispatchResult;
        if (!multiRepository && executionMode === 'autonomous') {
          if (!checkInvocation || !correctedCheckResult) {
            throw new Error('missing captured Build Check correction context');
          }
          const rejected = await status();
          expect(rejected.state.workExecution).toMatchObject({
            workId: checkInvocation.packet.work.workId,
            attempt: checkInvocation.packet.claim.attempt,
            checkEpoch: checkInvocation.packet.claim.checkEpoch,
            status: 'invoking',
            continuation: 'awaiting-correction',
            rejectedSubmissions: [{ rejection: { reasonCode: 'outcome-rejected' } }],
          });
          await application.context.managedWorkExecutor.acceptExternalOutcome({
            schemaVersion: 3,
            runId,
            submissionId: 'corrected-build-check-1',
            invocationId: checkInvocation.session.invocationId,
            hostId: 'capturing-work-execution-host',
            packetDigest: checkInvocation.session.packetDigest,
            status: 'succeeded',
            summary: 'Corrected Build Check uses the managed reviewer invocation',
            consumedLayerDigests: checkInvocation.packet.context.layers
              .filter((layer) => ['action-skill', 'augmentation-skill'].includes(layer.kind))
              .map((layer) => layer.digest),
            result: correctedCheckResult,
          });
          const checkCoordinator = Reflect.get(application.context.workflowRuns, 'coordinator') as {
            acceptChangeObservation: (...args: unknown[]) => Promise<unknown>;
          };
          const checkProjectionInterruption = vi
            .spyOn(checkCoordinator, 'acceptChangeObservation')
            .mockRejectedValueOnce(
              new Error('simulated interruption after Check Outcome validation'),
            );
          await expect(next()).rejects.toThrow(
            'simulated interruption after Check Outcome validation',
          );
          checkProjectionInterruption.mockRestore();
          expect((await status()).state.workExecution).toMatchObject({
            workId: checkInvocation.packet.work.workId,
            status: 'validated',
            acceptedSubmission: { submissionId: 'corrected-build-check-1' },
          });
          afterCheck = await next();
          const accepted = await status();
          expect(accepted.state.workExecution).toBeUndefined();
        }
        expect(afterCheck.value.changeLifecycle).toMatchObject({
          phase: 'verify',
          currentWork: { kind: 'evidence.verify' },
        });
        await restartApplication();
        await next();
        if (!multiRepository && executionMode === 'autonomous') {
          const inputDrift = vi
            .spyOn(application.context.evidenceCoordinator, 'runOrResume')
            .mockRejectedValueOnce(
              new Error('input fingerprint changed before Evidence execution'),
            );
          let failedVerify: RuntimeResult<VerifyChangeRunResult>;
          try {
            failedVerify = await application.context.commandRouter.execute<
              { runId: string },
              RuntimeResult<VerifyChangeRunResult>
            >('run.work.verify', { runId });
          } finally {
            inputDrift.mockRestore();
          }
          expect(failedVerify.value).toMatchObject({
            gate: 'blocked',
            run: {
              changeLifecycle: {
                phase: 'verify',
                currentWork: { kind: 'evidence.verify' },
              },
            },
          });
          const retryWorkId = failedVerify.value.run.changeLifecycle?.currentWork?.workId;
          const retryEpoch = failedVerify.value.run.changeLifecycle?.checkEpoch;
          const invocationCount = capture.invocations.length;
          const resumed = await application.context.workflowRuns.resume({
            runId,
            currentProjectSnapshot: await application.context.runStore.loadProjectSnapshot(runId),
          });
          expect(resumed.value.changeLifecycle).toMatchObject({
            currentWork: { workId: retryWorkId },
            checkEpoch: retryEpoch,
          });
          expect(capture.invocations).toHaveLength(invocationCount);
          const retriedEvidence = await next();
          expect(retriedEvidence.value.changeLifecycle).toMatchObject({
            phase: 'verify',
            currentWork: { kind: 'evidence.verify' },
          });
          await restartApplication();
        }
        const originalRunOrResume = application.context.evidenceCoordinator.runOrResume.bind(
          application.context.evidenceCoordinator,
        );
        let interruptedAttemptId = '';
        const evidenceInterruption = vi
          .spyOn(application.context.evidenceCoordinator, 'runOrResume')
          .mockImplementationOnce(async (...args) => {
            const evidence = await originalRunOrResume(...args);
            interruptedAttemptId = evidence.attempt.attemptId;
            expect(evidence.bundle?.outcome).toBe('passed');
            throw new Error('simulated interruption before Verify gate projection');
          });
        let interrupted: RuntimeResult<VerifyChangeRunResult>;
        try {
          interrupted = await application.context.commandRouter.execute<
            { runId: string },
            RuntimeResult<VerifyChangeRunResult>
          >('run.work.verify', { runId });
        } finally {
          evidenceInterruption.mockRestore();
        }
        expect(interrupted.value).toMatchObject({
          gate: 'blocked',
          run: {
            changeLifecycle: {
              phase: 'verify',
              status: 'running',
              currentWork: { kind: 'evidence.verify' },
              evidence: { gateStatus: 'pending' },
            },
          },
        });
        expect(interruptedAttemptId).toMatch(/^verify-[a-f0-9]{64}$/u);
        const recoveryApplication = await bootProjectComposition(productRoot, workspace);
        let recovered: RuntimeResult<RunStatusView>;
        try {
          const recoveryHost = installCapturingWorkExecutionHost({
            context: recoveryApplication.context,
            workspace,
            repositories: { workspace, app: appRepository, worker: workerRepository },
            operations: () => [],
          });
          await recoveryApplication.context.commandRouter.execute<
            { runId: string },
            RuntimeResult<RunStatusView>
          >('run.next', { runId });
          recovered = await recoveryApplication.context.commandRouter.execute<
            { runId: string },
            RuntimeResult<RunStatusView>
          >('run.next', { runId });
          recoveryHost.dispose();
        } finally {
          await recoveryApplication.close();
        }
        expect(recovered.value.changeLifecycle).toMatchObject({
          phase: 'archive',
          currentWork: null,
        });
        const interruptedEvidence =
          await application.context.evidenceCoordinator.status(interruptedAttemptId);
        expect(interruptedEvidence.context.status).toBe('completed');
        const acceptedAttemptId = recovered.value.changeLifecycle?.evidence.latestAttemptId;
        expect(acceptedAttemptId).toMatch(/^verify-[a-f0-9]{64}$/u);
        const recoveredEvidence = await application.context.evidenceCoordinator.status(
          acceptedAttemptId!,
        );
        expect(recovered.value.state.acceptedEvidenceBundleIds).toEqual([
          recoveredEvidence.bundle!.bundleId,
        ]);

        await execFileAsync('git', ['add', 'openspec/changes/managed-blackbox/tasks.md'], {
          cwd: workspace,
        });
        const taskStatus = await execFileAsync('git', ['status', '--porcelain'], {
          cwd: workspace,
        });
        if (taskStatus.stdout.trim()) {
          await execFileAsync('git', ['commit', '-m', 'spec: record managed task completion'], {
            cwd: workspace,
          });
          await execFileAsync('git', ['push'], { cwd: workspace });
        }

        if (multiRepository && !protectedWriteRepositories) {
          invocationKinds.push(...capture.invocations.map((item) => item.packet.work.kind));
          capture.dispose();
          await application.close();
          for (const command of ['resume', 'next', 'resume']) {
            const cold = await runCli<ResumeView>({
              packageRoot: productRoot,
              cwd: workspace,
              environment,
              args: ['run', command, '--workspace', workspace, '--run', runId],
            });
            expect(
              cold.result!.state.reconciliationRequired,
              'neutral task commit cold recovery',
            ).toBe(false);
            expect(cold.result!.changeLifecycle?.phase).toBe('archive');
            expect(cold.result!.state.acceptedEvidenceBundleIds).toEqual(
              recovered.value.state.acceptedEvidenceBundleIds,
            );
            expect(cold.result!.state.changeLifecycle?.buildProtocol?.packageCompletions).toEqual(
              recovered.value.state.changeLifecycle?.buildProtocol?.packageCompletions,
            );
          }
          application = await bootProjectComposition(productRoot, workspace);
          capture = installCapturingWorkExecutionHost({
            context: application.context,
            workspace,
            repositories: { workspace, app: appRepository, worker: workerRepository },
            operations: () => [],
          });
        }
        const project = await application.context.project.snapshot({
          workspaceId: 'managed-blackbox',
          workspaceRoot: workspace,
          workspaceRepositoryId: 'workspace',
          repositories: [
            { id: 'workspace', path: workspace },
            { id: 'app', path: appRepository },
            ...(multiRepository ? [{ id: 'worker', path: workerRepository }] : []),
          ],
        });
        const changeRemoteOid = (
          await execFileAsync('git', ['rev-parse', 'origin/spec/managed-blackbox'], {
            cwd: workspace,
          })
        ).stdout.trim();
        const intent: DeliveryIntentV3 = {
          schemaVersion: 3,
          changeId: 'managed-blackbox',
          changeBranch: {
            repositoryId: 'workspace',
            remoteIdentity: approval.snapshot.changeBranch.remoteIdentity,
            sourceBranch: 'spec/managed-blackbox',
            targetBranch: 'main',
            remoteOid: changeRemoteOid,
          },
          businessDeliveries: [
            {
              deliveryId: 'app',
              repositoryId: 'app',
              sourceBranch: project.repositories.find((repo) => repo.id === 'app')!.branch!,
              targetBranch: 'main',
              commitMessage: 'feat: add managed outputs',
              actions: ['push', 'merge_request'],
            },
            ...(multiRepository
              ? [
                  {
                    deliveryId: 'worker',
                    repositoryId: 'worker',
                    sourceBranch: project.repositories.find((repo) => repo.id === 'worker')!
                      .branch!,
                    targetBranch: 'main',
                    commitMessage: 'feat: add managed worker output',
                    actions: ['push', 'merge_request'] as Array<'push' | 'merge_request'>,
                  },
                ]
              : []),
          ],
          ...(multiRepository
            ? {
                businessSplitReason: {
                  kind: 'multi_repository' as const,
                  summary:
                    'The managed Change intentionally spans the app and worker repositories.',
                },
              }
            : {}),
        };
        vi.spyOn(application.context.delivery, 'validateArchiveIntent').mockResolvedValue();
        const preparedArchive = await application.context.commandRouter.execute<
          { runId: string; attemptId: string; intent: DeliveryIntentV3; policy: DeliveryPolicy },
          RuntimeResult<RunStatusView>
        >('run.archive.prepare', {
          runId,
          attemptId: acceptedAttemptId!,
          intent,
          policy,
        });
        expect(
          preparedArchive.value.changeLifecycle?.phase,
          'committing Runtime task completion must preserve the accepted Verify evidence',
        ).toBe('archive');
        expect(preparedArchive.value.state.acceptedEvidenceBundleIds).toEqual(
          recovered.value.state.acceptedEvidenceBundleIds,
        );
        expect(preparedArchive.value.changeLifecycle?.evidence.latestAttemptId).toBe(
          acceptedAttemptId,
        );
        await next();
        if (derivedCloseDrift) {
          const before = await application.context.evidenceCoordinator.plan('verify', runId);
          await writeFile(path.join(appRepository, 'evidence-dist', 'value.txt'), 'tampered');
          const after = await application.context.evidenceCoordinator.plan('verify', runId);
          expect(after.fingerprint.digest).toBe(before.fingerprint.digest);
          const prepare = vi.spyOn(application.context.specification, 'prepareClosure');
          const result = await application.context.workflowRuns.executeArchiveDelivery({
            runId,
            project,
            policy,
            executor: {
              actorId: 'managed-test-user',
              runnerId: 'managed-test-runner',
              source: 'runner',
              authenticated: true,
            },
          });
          expect(result.value.stage).toBe('reverify-required');
          expect(result.value.run.changeLifecycle?.phase).toBe('verify');
          expect(result.value.run.changeLifecycle?.currentWork?.kind).toBe('evidence.verify');
          expect(prepare).not.toHaveBeenCalled();
          return;
        }
        const closed = await application.context.commandRouter.execute<
          {
            runId: string;
            project: typeof project;
            policy: DeliveryPolicy;
            executor: {
              actorId: string;
              runnerId: string;
              source: 'runner';
              authenticated: boolean;
            };
          },
          RuntimeResult<ExecuteArchiveDeliveryResult>
        >('run.archive.publish', {
          runId,
          project,
          policy,
          executor: {
            actorId: 'managed-test-user',
            runnerId: 'managed-test-runner',
            source: 'runner',
            authenticated: true,
          },
        });
        expect(closed.value.stage).toBe('specification-closed');
        const closure = closed.value.run.changeLifecycle?.specificationClosure;
        if (!closure) throw new Error('missing specification closure');
        const businessRepository = project.repositories.find(
          (repository) => repository.id === 'app',
        )!;
        const workerBusinessRepository = project.repositories.find(
          (repository) => repository.id === 'worker',
        );
        vi.spyOn(application.context.delivery, 'publishArchive').mockResolvedValue({
          snapshot: { digest: `sha256:${'d'.repeat(64)}` } as never,
          receipts: [
            {
              actionId: 'push-app',
              deliveryId: 'app',
              type: 'git.push',
              status: 'succeeded',
              recovered: false,
              remoteOid: 'a'.repeat(40),
            },
            {
              actionId: 'mr-app',
              deliveryId: 'app',
              type: 'mr.create_or_update',
              status: 'succeeded',
              recovered: false,
              mergeRequest: {
                provider: 'github',
                repositoryId: 'app',
                number: 101,
                url: 'https://github.com/example/app/pull/101',
              },
              provenance: 'runtime-created',
            },
            ...(multiRepository
              ? [
                  {
                    actionId: 'push-worker',
                    deliveryId: 'worker',
                    type: 'git.push' as const,
                    status: 'succeeded' as const,
                    recovered: false,
                    remoteOid: 'c'.repeat(40),
                  },
                  {
                    actionId: 'mr-worker',
                    deliveryId: 'worker',
                    type: 'mr.create_or_update' as const,
                    status: 'succeeded' as const,
                    recovered: false,
                    mergeRequest: {
                      provider: 'github' as const,
                      repositoryId: 'worker',
                      number: 103,
                      url: 'https://github.com/example/worker/pull/103',
                    },
                    provenance: 'runtime-created' as const,
                  },
                ]
              : []),
          ],
        });
        vi.spyOn(application.context.delivery, 'publishSpecification').mockResolvedValue({
          expectedPublishedOid: 'b'.repeat(40),
          item: {
            publicationId: 'specification',
            role: 'specification',
            repositoryId: 'workspace',
            remoteIdentity: project.repositories.find(
              (repository) => repository.id === 'workspace',
            )!.remoteIdentity!,
            remote: 'origin',
            sourceBranch: 'spec/managed-blackbox',
            targetBranch: 'main',
            publishedOid: 'b'.repeat(40),
            mergeRequest: {
              provider: 'github',
              repositoryId: 'workspace',
              number: 102,
              url: 'https://github.com/example/workspace/pull/102',
            },
            provenance: 'runtime-created',
            verifiedAt: new Date().toISOString(),
          },
        });
        expect(businessRepository.remoteIdentity).toBeTruthy();
        if (multiRepository) expect(workerBusinessRepository?.remoteIdentity).toBeTruthy();
        await next();
        const published = await application.context.commandRouter.execute<
          Parameters<typeof application.context.workflowRuns.executeArchiveDelivery>[0],
          RuntimeResult<ExecuteArchiveDeliveryResult>
        >('run.archive.publish', {
          runId,
          project,
          policy,
          executor: {
            actorId: 'managed-test-user',
            runnerId: 'managed-test-runner',
            source: 'runner',
            authenticated: true,
          },
        });
        expect(published.value).toMatchObject({
          stage: 'published',
          run: { changeLifecycle: { phase: 'archive', status: 'completed' } },
        });
        invocationKinds.push(...capture.invocations.map((item) => item.packet.work.kind));
        expect(invocationKinds).toEqual([
          'change.intake',
          ...(!multiRepository && executionMode === 'autonomous'
            ? ['change.intake', 'change.intake']
            : []),
          'specification.plan',
          'build.configure',
          'build.plan',
          'build.execute',
          'build.execute',
          'build.check',
          'evidence.verify',
          ...(!multiRepository && executionMode === 'autonomous' ? ['evidence.verify'] : []),
          'specification.close',
          'delivery.publish',
        ]);
        const inspection = await application.context.commandRouter.execute<
          { runId: string },
          RunStoreInspection
        >('run.inspect', { runId });
        const types = inspection.trajectory.map((event) => event.type);
        const ordered = [
          'work.claimed',
          'work.context-delivered',
          'work.host-started',
          'tool.started',
          'tool.completed',
          'work.host-completed',
          'work.completed',
          'validator.completed',
          'change.lifecycle.transitioned',
        ];
        let cursor = -1;
        for (const type of ordered) {
          cursor = types.indexOf(type as (typeof types)[number], cursor + 1);
          expect(cursor, type).toBeGreaterThan(-1);
        }
        expect(JSON.stringify(inspection)).not.toContain('Prove managed execution');
        capture.dispose();
      } finally {
        await application.close();
        for (const key of environmentKeys) {
          const previous = previousEnvironment[key];
          if (previous === undefined) delete process.env[key];
          else process.env[key] = previous;
        }
      }
    },
    // The expanded matrix includes three independent cold CLI restores after
    // Verify; the previous 240s budget expired during the added Archive path.
    360_000,
  );

  it('recovers one persisted Run from current to worktree across process restarts', async () => {
    const root = await temporaryDirectory('repoctopus-workspace-intent-recovery-');
    cleanup.push(root);
    const remote = path.join(root, 'workspace.git');
    await mkdir(remote);
    await execFileAsync('git', ['init', '--bare', '--initial-branch=main'], { cwd: remote });
    const workspace = await createGitRepository(root, 'workspace', remote);
    await execFileAsync('git', ['push', '--set-upstream', 'origin', 'main'], { cwd: workspace });
    await execFileAsync('git', ['switch', '-c', 'spec/intent-recovery-e2e'], {
      cwd: workspace,
    });
    await execFileAsync('git', ['push', '--set-upstream', 'origin', 'spec/intent-recovery-e2e'], {
      cwd: workspace,
    });
    const environment = await createOpenSpecStoreEnvironment(
      root,
      workspace,
      'intent-recovery-e2e',
    );
    const changeRoot = path.join(workspace, 'openspec', 'changes', 'intent-recovery-e2e');
    await mkdir(path.join(changeRoot, 'specs', 'workspace-recovery'), { recursive: true });
    await Promise.all([
      writeFile(path.join(workspace, '.gitignore'), '.repoctopus/\n'),
      writeFile(
        path.join(workspace, 'repoctopus.yaml'),
        JSON.stringify({
          apiVersion: 'repoctopus/v1alpha1',
          kind: 'RepoctopusWorkspace',
          workspace: { id: 'intent-recovery-e2e', repositoryId: 'workspace' },
          repositories: [{ id: 'workspace', path: '.' }],
          profiles: [
            {
              id: 'verify',
              nodes: [
                {
                  id: 'workspace-check',
                  type: 'command',
                  repository: 'workspace',
                  covers: ['*'],
                  executable: process.execPath,
                  args: ['-e', 'process.exit(0)'],
                },
              ],
            },
          ],
          specificationProvider: {
            id: 'specification-openspec',
            store: { id: 'intent-recovery-e2e', repositoryId: 'workspace' },
          },
        }),
      ),
      writeFile(
        path.join(changeRoot, 'proposal.md'),
        '# Proposal\n\n## Why\n\nProve same-Run Workspace recovery.\n\n## What Changes\n\n- Recover a persisted current intent to worktree isolation.\n\n## Capabilities\n\n### New Capabilities\n\n- `workspace-recovery`: recover one Run.\n\n### Modified Capabilities\n\n## Impact\n\n- Runtime recovery only.\n',
      ),
      writeFile(
        path.join(changeRoot, 'design.md'),
        '# Design\n\n## Context\n\nA checkout can become a linked worktree after approval.\n\n## Goals / Non-Goals\n\n**Goals:**\n- Preserve one Run while revising isolation.\n\n**Non-Goals:**\n- Edit Runtime Store files.\n\n## Decisions\n\nUse the protected Workspace intent decision.\n',
      ),
      writeFile(
        path.join(changeRoot, 'tasks.md'),
        '# Tasks\n\n- [ ] 1.1 Prove same-Run recovery.\n  **Acceptance:** The Run reaches worktree-backed Design.\n  **Requirements:** workspace-recovery#same-run-recovery\n',
      ),
      writeFile(
        path.join(changeRoot, 'specs', 'workspace-recovery', 'spec.md'),
        '# Workspace Recovery Delta\n\n## ADDED Requirements\n\n### Requirement: Same Run recovery\n\nThe Runtime MUST preserve the Run identity while revising Workspace isolation.\n\n#### Scenario: Current checkout becomes linked\n\n- **WHEN** Build Configure cannot bind current isolation\n- **THEN** the same Run returns through Open to worktree-backed Design\n',
      ),
    ]);
    await execFileAsync('git', ['add', '.'], { cwd: workspace });
    await execFileAsync('git', ['commit', '-m', 'test: prepare workspace recovery change'], {
      cwd: workspace,
    });
    await execFileAsync('git', ['push'], { cwd: workspace });

    const started = await runCli<RunStatusView>({
      packageRoot: productRoot,
      cwd: workspace,
      environment,
      args: [
        'run',
        'start',
        '--workspace',
        workspace,
        '--change',
        'intent-recovery-e2e',
        '--target',
        'main',
      ],
    });
    const runId = started.runId!;
    const environmentKeys = [
      'XDG_DATA_HOME',
      'XDG_CONFIG_HOME',
      'OPENSPEC_NO_UPDATE_CHECK',
      'OPENSPEC_TELEMETRY',
    ] as const;
    const previousEnvironment = Object.fromEntries(
      environmentKeys.map((key) => [key, process.env[key]]),
    );
    for (const key of environmentKeys) process.env[key] = environment[key];

    let decisionDriver: string | null = null;
    let application = await bootProjectComposition(productRoot, workspace);
    const installHost = () =>
      installCapturingWorkExecutionHost({
        context: application.context,
        workspace,
        repositories: { workspace },
        operations: () => [],
        result(packet) {
          const inputs = JSON.parse(
            packet.context.layers.find((layer) => layer.kind === 'change-inputs')!.content,
          ) as { build: { strategy: { semanticDigest: `sha256:${string}` } } };
          return packet.work.kind === 'build.configure'
            ? {
                schemaVersion: 1,
                kind: 'execution-binding-candidate',
                strategyDigest: inputs.build.strategy.semanticDigest,
              }
            : undefined;
        },
      });
    let capture = installHost();
    const next = () =>
      application.context.commandRouter.execute<{ runId: string }, RuntimeResult<RunStatusView>>(
        'run.next',
        { runId },
      );
    const status = () =>
      application.context.commandRouter.execute<{ runId: string }, RunStatusView>('run.status', {
        runId,
      });
    const advanceUntil = async (
      predicate: (view: RunStatusView) => boolean,
      limit = 10,
    ): Promise<RunStatusView> => {
      let latest: RunStatusView | null = null;
      for (let index = 0; index < limit; index += 1) {
        const view = (await next()).value;
        latest = view;
        if (predicate(view)) return view;
      }
      throw new Error(
        `Managed recovery fixture did not reach its expected boundary: ${JSON.stringify({
          phase: latest?.changeLifecycle?.phase,
          status: latest?.changeLifecycle?.status,
          work: latest?.changeLifecycle?.currentWork?.kind,
          wait: latest?.changeLifecycle?.waitCondition?.kind,
          continuation: latest?.continuation,
        })}`,
      );
    };

    try {
      const openWait = await advanceUntil(
        (view) =>
          view.changeLifecycle?.phase === 'open' && view.changeLifecycle.status === 'waiting',
      );
      expect(openWait.state.runId).toBe(runId);
      const openApproval = await application.context.commandRouter.execute<
        { changeId: string; approvalPhase: 'open' },
        SpecificationApprovalState | null
      >('specification.approval.status', {
        changeId: 'intent-recovery-e2e',
        approvalPhase: 'open',
      });
      if (!openApproval || openApproval.status !== 'awaiting_approval') {
        throw new Error('Missing Open approval for Workspace recovery fixture');
      }
      await application.context.commandRouter.execute('run.change.decide', {
        runId,
        response: {
          apiVersion: 'repoctopus/v1alpha1',
          kind: 'HumanDecisionResponse',
          requestId: openApproval.decisionRequest.requestId,
          proposalHash: openApproval.decisionRequest.proposalHash,
          decision: 'approve',
        },
        actor: { actorId: 'cross-process-test', source: 'ide', authenticated: true },
        isolation: 'current',
      });
      expect((await next()).value.changeLifecycle).toMatchObject({
        phase: 'design',
        currentWork: { kind: 'specification.plan' },
        workspaceIntent: { isolation: 'current' },
      });
      capture.dispose();
      await application.close();
      const mainCheckout = path.join(root, 'workspace-main');
      await rename(workspace, mainCheckout);
      await execFileAsync('git', ['switch', 'main'], { cwd: mainCheckout });
      await execFileAsync('git', ['worktree', 'add', workspace, 'spec/intent-recovery-e2e'], {
        cwd: mainCheckout,
      });
      await rename(path.join(mainCheckout, '.repoctopus'), path.join(workspace, '.repoctopus'));
      application = await bootProjectComposition(productRoot, workspace);
      capture = installHost();

      const designWait = await advanceUntil(
        (view) =>
          view.changeLifecycle?.phase === 'design' && view.changeLifecycle.status === 'waiting',
      );
      expect(designWait.changeLifecycle?.workspaceIntent?.isolation).toBe('current');
      const designApproval = await application.context.commandRouter.execute<
        { changeId: string; approvalPhase: 'design' },
        SpecificationApprovalState | null
      >('specification.approval.status', {
        changeId: 'intent-recovery-e2e',
        approvalPhase: 'design',
      });
      if (!designApproval || designApproval.status !== 'awaiting_approval') {
        throw new Error('Missing Design approval for Workspace recovery fixture');
      }
      await application.context.commandRouter.execute('run.change.decide', {
        runId,
        response: {
          apiVersion: 'repoctopus/v1alpha1',
          kind: 'HumanDecisionResponse',
          requestId: designApproval.decisionRequest.requestId,
          proposalHash: designApproval.decisionRequest.proposalHash,
          decision: 'approve',
        },
        actor: { actorId: 'cross-process-test', source: 'ide', authenticated: true },
      });
      const configure = await advanceUntil(
        (view) => view.changeLifecycle?.currentWork?.kind === 'build.configure',
      );
      const configureWorkId = configure.changeLifecycle!.currentWork!.workId;
      expect(configureWorkId).toMatch(/^build\.configure:/u);
      await next();
      const intentRevision = await status();
      expect(intentRevision.changeLifecycle).toMatchObject({
        phase: 'open',
        status: 'waiting',
        currentWork: null,
        waitCondition: {
          kind: 'human-decision',
          workspaceIntentRevision: { errorCode: 'current-linked-worktree' },
        },
      });
      expect(intentRevision.state.workExecution).toBeUndefined();
      capture.dispose();
      await application.close();

      let recoveryView: RunStatusView | null = null;
      for (let index = 0; index < 4; index += 1) {
        const resumed = await runCli<RunStatusView>({
          packageRoot: productRoot,
          cwd: workspace,
          environment,
          args: ['run', 'next', '--workspace', workspace, '--run', runId],
        });
        recoveryView = resumed.result;
        if (
          recoveryView?.changeLifecycle?.phase === 'open' &&
          recoveryView.changeLifecycle.status === 'waiting'
        ) {
          break;
        }
      }
      expect(
        recoveryView,
        JSON.stringify({
          lifecycle: recoveryView?.changeLifecycle,
          reason: recoveryView?.reason,
          continuation: recoveryView?.continuation,
        }),
      ).toMatchObject({
        state: { runId },
        changeLifecycle: {
          phase: 'open',
          status: 'waiting',
          currentWork: null,
          waitCondition: {
            kind: 'human-decision',
            workspaceIntentRevision: {
              errorCode: 'current-linked-worktree',
              previousIsolation: 'current',
            },
          },
        },
      });
      expect(recoveryView!.changeLifecycle).not.toHaveProperty('workspaceIntent');
      expect(recoveryView!.state.workExecution).toBeUndefined();
      const revisionEpoch = recoveryView!.changeLifecycle!.checkEpoch;
      const revisionWaitId = recoveryView!.changeLifecycle!.waitCondition!.waitId;

      for (let index = 0; index < 2; index += 1) {
        const pulled = await runCli<RunStatusView>({
          packageRoot: productRoot,
          cwd: workspace,
          environment,
          args: ['run', 'next', '--workspace', workspace, '--run', runId],
        });
        expect(pulled.result?.changeLifecycle).toMatchObject({
          phase: 'open',
          status: 'waiting',
          checkEpoch: revisionEpoch,
          waitCondition: { waitId: revisionWaitId },
        });
        expect(pulled.result?.state.workExecution).toBeUndefined();
      }

      const decisionDriverSource = path.join(
        productRoot,
        'test',
        'fixtures',
        'workspace-intent-recovery-driver.ts',
      );
      decisionDriver = path.join(
        productRoot,
        '.repoctopus',
        `workspace-intent-recovery-driver-${path.basename(root)}.mjs`,
      );
      await mkdir(path.dirname(decisionDriver), { recursive: true });
      await build({
        entryPoints: [decisionDriverSource],
        outfile: decisionDriver,
        bundle: true,
        packages: 'external',
        platform: 'node',
        target: 'node22',
        format: 'esm',
      });
      for (let index = 0; index < 2; index += 1) {
        const invalid = await execFileAsync(
          process.execPath,
          [decisionDriver, workspace, runId, 'current', productRoot],
          { cwd: workspace, env: environment, maxBuffer: 1024 * 1024 },
        );
        expect(JSON.parse(invalid.stdout)).toMatchObject({
          ok: false,
          errorCode: 'current-linked-worktree',
          runId,
          phase: 'open',
          checkEpoch: revisionEpoch,
          waitId: revisionWaitId,
        });
      }
      const revised = await execFileAsync(
        process.execPath,
        [decisionDriver, workspace, runId, 'worktree', productRoot],
        { cwd: workspace, env: environment, maxBuffer: 1024 * 1024 },
      );
      expect(JSON.parse(revised.stdout)).toMatchObject({
        ok: true,
        runId,
        phase: 'design',
        isolation: 'worktree',
      });
      const finalStatus = await runCli<RunStatusView>({
        packageRoot: productRoot,
        cwd: workspace,
        environment,
        args: ['run', 'status', '--workspace', workspace, '--run', runId],
      });
      expect(finalStatus.result).toMatchObject({
        state: { runId },
        changeLifecycle: {
          phase: 'design',
          currentWork: { kind: 'specification.plan' },
          workspaceIntent: { isolation: 'worktree' },
        },
      });
      expect(finalStatus.result!.changeLifecycle!.currentWork!.workId).not.toBe(configureWorkId);
      expect(await readdir(path.join(workspace, '.repoctopus', 'runs'))).toEqual([runId]);
    } finally {
      capture.dispose();
      await application.close();
      if (decisionDriver) await rm(decisionDriver, { force: true });
      for (const key of environmentKeys) {
        const previous = previousEnvironment[key];
        if (previous === undefined) delete process.env[key];
        else process.env[key] = previous;
      }
    }
  }, 120_000);
});
