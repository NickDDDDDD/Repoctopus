import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { bootProjectComposition } from '../app/boot/bootstrap.js';
import type { DeliveryIntentV3, DeliveryPolicy } from '../domains/delivery/types.js';
import type { RunStatusView, RuntimeResult } from '../domains/runtime/types.js';
import type { RunStoreInspection } from '../domains/runtime/types.js';
import type { SpecificationApprovalState } from '../domains/specification/types.js';
import type { WorkExecutionResult } from '../domains/work-execution/types.js';
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
  ])(
    'executes fresh Open -> Design -> Build -> Verify -> Archive in $label',
    async ({ executionMode, multiRepository }) => {
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
      await execFileAsync('git', ['switch', '-c', 'feature/managed-blackbox'], {
        cwd: appRepository,
      });
      await execFileAsync('git', ['push', '--set-upstream', 'origin', 'feature/managed-blackbox'], {
        cwd: appRepository,
      });
      await execFileAsync('git', ['switch', '-c', 'feature/managed-blackbox'], {
        cwd: workerRepository,
      });
      await execFileAsync('git', ['push', '--set-upstream', 'origin', 'feature/managed-blackbox'], {
        cwd: workerRepository,
      });
      const environment = await createOpenSpecStoreEnvironment(root, workspace, 'managed-blackbox');
      await writeFile(path.join(workspace, '.gitignore'), '.repoctopus/\n');
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
                  args: ['-e', 'process.exit(0)'],
                },
                ...(multiRepository
                  ? [
                      {
                        id: 'worker-check',
                        type: 'command',
                        repository: 'worker',
                        covers: ['*'],
                        executable: process.execPath,
                        args: ['-e', 'process.exit(0)'],
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
        }),
      );
      await execFileAsync('git', ['add', '.'], { cwd: workspace });
      await execFileAsync('git', ['commit', '-m', 'chore: configure managed execution'], {
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
          'managed-blackbox',
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
      let application = await bootProjectComposition(productRoot, workspace);
      try {
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
                  configuration: { bindingDigest: `sha256:${string}` };
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
                return {
                  schemaVersion: 1,
                  kind: 'build-configuration-candidate',
                  executionMode,
                  tddMode: 'tdd',
                };
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
                      validatorProfile: 'build-package-v1',
                      dependsOn: index === 0 ? [] : [inputs.tasks[index - 1]!.taskId],
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
                  repositoryDigest: inputs.build!.configuration.bindingDigest,
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
                  repositoryDigest: inputs.build!.configuration.bindingDigest,
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

        expect((await next()).value).toMatchObject({
          changeLifecycle: { phase: 'open', currentWork: { kind: 'change.intake' } },
          continuation: { reason: 'validator-pending' },
        });
        expect((await next()).value.changeLifecycle).toMatchObject({
          phase: 'open',
          status: 'waiting',
          currentWork: null,
          waitCondition: { kind: 'human-decision' },
        });
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
          isolation: 'current',
        });
        const designWork = await next();
        expect(designWork.value.changeLifecycle).toMatchObject({
          phase: 'design',
          currentWork: { kind: 'specification.plan' },
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
          continuation: { reason: 'validator-pending' },
        });
        expect((await status()).state.workExecution).toMatchObject({
          status: 'outcome',
          workId: designWorkId,
        });
        const waiting = await next();
        transientDesignFailure.mockRestore();
        expect(waiting.value.changeLifecycle).toMatchObject({ phase: 'design', status: 'waiting' });
        expect((await status()).state.workExecution).toMatchObject({
          status: 'outcome',
          workId: designWorkId,
        });
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
        invocationKinds.push(...capture.invocations.map((item) => item.packet.work.kind));
        capture.dispose();
        await application.close();
        application = await bootProjectComposition(productRoot, workspace);
        const configurationWait = await next();
        capture = installHost();
        expect(configurationWait.value.changeLifecycle).toMatchObject({
          phase: 'build',
          status: 'waiting',
          currentWork: null,
          waitCondition: { kind: 'human-decision' },
          build: { action: 'configure' },
        });
        const configurationDecision = configurationWait.value.changeLifecycle!.waitCondition!;
        if (configurationDecision.kind !== 'human-decision') {
          throw new Error('missing Build Configuration decision');
        }
        await restartApplication();
        const planned = await application.context.commandRouter.execute<
          Parameters<typeof application.context.workflowRuns.decideChange>[0],
          RunStatusView
        >('run.change.decide', {
          runId,
          response: {
            apiVersion: 'repoctopus/v1alpha1',
            kind: 'HumanDecisionResponse',
            requestId: configurationDecision.requestId,
            proposalHash: configurationDecision.proposalDigest,
            decision: 'approve',
          },
          actor: { actorId: 'managed-test-user', source: 'cli', authenticated: true },
        });
        expect(planned.changeLifecycle).toMatchObject({
          phase: 'build',
          currentWork: { kind: 'build.plan' },
          build: { action: 'plan' },
        });
        await next();
        const planInvocation = capture.invocations.findLast(
          (entry) => entry.packet.work.kind === 'build.plan',
        );
        invocationKinds.push(...capture.invocations.map((item) => item.packet.work.kind));
        capture.dispose();
        await application.close();
        application = await bootProjectComposition(productRoot, workspace);
        let afterPlanValidation = await next();
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
          expect(accepted.state.workExecution).toMatchObject({
            workId: planInvocation.packet.work.workId,
            attempt: planInvocation.packet.claim.attempt,
            checkEpoch: planInvocation.packet.claim.checkEpoch,
            status: 'validated',
            acceptedSubmission: { submissionId: 'corrected-build-plan-1' },
          });
          expect(accepted.state.workExecution?.rejectedSubmissions).toHaveLength(1);
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
        let afterFirstPackage: RunStatusView;
        let afterAllPackages: RuntimeResult<RunStatusView>;
        if (!multiRepository && executionMode === 'autonomous') {
          const successAcceptanceInterruption = vi
            .spyOn(application.context.workDispatcher, 'acceptOutcome')
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
          expect(afterFirstPackage.state.workExecution).toMatchObject({
            status: 'validated',
          });
          expect(afterFirstPackage.state.workExecution?.workId).not.toBe(
            afterFirstPackage.changeLifecycle?.currentWork?.workId,
          );

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
          await next();
          afterFirstPackage = (await next()).value;
          await restartApplication();
          await next();
          afterAllPackages = await next();
        }
        expect(afterFirstPackage.changeLifecycle).toMatchObject({
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
        await execFileAsync('git', ['add', 'openspec/changes/managed-blackbox/tasks.md'], {
          cwd: workspace,
        });
        await execFileAsync('git', ['commit', '-m', 'spec: record managed task completion'], {
          cwd: workspace,
        });
        await execFileAsync('git', ['push'], { cwd: workspace });
        await execFileAsync('git', ['add', 'src'], { cwd: appRepository });
        await execFileAsync('git', ['commit', '-m', 'feat: add managed outputs'], {
          cwd: appRepository,
        });
        await execFileAsync('git', ['push'], { cwd: appRepository });
        if (multiRepository) {
          await execFileAsync('git', ['add', 'src'], { cwd: workerRepository });
          await execFileAsync('git', ['commit', '-m', 'feat: add managed worker output'], {
            cwd: workerRepository,
          });
          await execFileAsync('git', ['push'], { cwd: workerRepository });
        }
        await next();
        const checkInvocation = capture.invocations.findLast(
          (entry) => entry.packet.work.kind === 'build.check',
        );
        let afterCheck = await next();
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
          expect(accepted.state.workExecution).toMatchObject({
            workId: checkInvocation.packet.work.workId,
            attempt: checkInvocation.packet.claim.attempt,
            checkEpoch: checkInvocation.packet.claim.checkEpoch,
            status: 'validated',
            acceptedSubmission: { submissionId: 'corrected-build-check-1' },
          });
        }
        expect(afterCheck.value.changeLifecycle).toMatchObject({
          phase: 'verify',
          currentWork: { kind: 'evidence.verify' },
        });
        await restartApplication();
        await next();
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
              evidence: { gateStatus: 'failed' },
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

        await execFileAsync(
          'git',
          ['remote', 'set-url', 'origin', 'https://github.com/example/workspace.git'],
          { cwd: workspace },
        );
        await execFileAsync(
          'git',
          ['remote', 'set-url', 'origin', 'https://github.com/example/app.git'],
          { cwd: appRepository },
        );
        if (multiRepository) {
          await execFileAsync(
            'git',
            ['remote', 'set-url', 'origin', 'https://github.com/example/worker.git'],
            { cwd: workerRepository },
          );
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
              sourceBranch: 'feature/managed-blackbox',
              targetBranch: 'main',
              commitMessage: 'feat: add managed outputs',
              actions: ['push', 'merge_request'],
            },
            ...(multiRepository
              ? [
                  {
                    deliveryId: 'worker',
                    repositoryId: 'worker',
                    sourceBranch: 'feature/managed-blackbox',
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
        await application.context.commandRouter.execute('run.archive.prepare', {
          runId,
          attemptId: acceptedAttemptId,
          intent,
          policy,
        });
        await next();
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
          'specification.plan',
          'build.configure',
          'build.plan',
          'build.execute',
          'build.execute',
          'build.check',
          'evidence.verify',
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
    120_000,
  );
});
