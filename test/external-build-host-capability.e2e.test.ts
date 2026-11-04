import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { bootProjectComposition } from '../app/boot/bootstrap.js';
import type { RuntimeResult, RunStatusView } from '../domains/runtime/types.js';
import type { SpecificationApprovalState } from '../domains/specification/types.js';
import type {
  WorkExecutionPacket,
  WorkExecutionResult,
} from '../domains/work-execution/types.js';
import type { ExternalWorkClaimResult } from '../services/managed-work-executor.js';
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

const executor = {
  actorId: 'external-host-test-user',
  runnerId: 'external-host-test-runner',
  source: 'cli' as const,
  authenticated: true,
};

function consumedLayers(packet: WorkExecutionPacket): `sha256:${string}`[] {
  return packet.context.layers
    .filter((layer) => ['action-skill', 'augmentation-skill'].includes(layer.kind))
    .map((layer) => layer.digest);
}

function changeInputs(packet: WorkExecutionPacket) {
  return JSON.parse(
    packet.context.layers.find((layer) => layer.kind === 'change-inputs')!.content,
  ) as {
    tasks: Array<{
      taskId: string;
      acceptanceCriteria: Array<{ acceptanceId: string }>;
    }>;
    build: {
      strategy: { semanticDigest: `sha256:${string}` };
      plan: {
        packages: Array<{
          packageId: string;
          taskIds: string[];
          repositoryIds: string[];
        }>;
      } | null;
      currentPackage: { packageId: string; repositoryIds: string[] } | null;
    };
  };
}

describe('external Build Host Work-scoped capabilities', () => {
  it.each([
    { label: 'single repository', multiRepository: false },
    { label: 'multiple repositories', multiRepository: true },
  ])(
    'executes Configure -> Plan -> blocked/accepted Execute -> Check with minimal capabilities in $label',
    async ({ multiRepository }) => {
      const root = await temporaryDirectory('repoctopus-external-capability-');
      cleanup.push(root);
      const workspaceRemote = path.join(root, 'workspace.git');
      const appRemote = path.join(root, 'app.git');
      const workerRemote = path.join(root, 'worker.git');
      for (const remote of [workspaceRemote, appRemote, workerRemote]) {
        await mkdir(remote);
        await execFileAsync('git', ['init', '--bare', '--initial-branch=main'], { cwd: remote });
      }
      const workspace = await createGitRepository(root, 'workspace', workspaceRemote);
      const appRepository = await createGitRepository(root, 'app', appRemote);
      const workerRepository = await createGitRepository(root, 'worker', workerRemote);
      for (const repository of [workspace, appRepository, workerRepository]) {
        await execFileAsync('git', ['push', '--set-upstream', 'origin', 'main'], {
          cwd: repository,
        });
      }
      await execFileAsync('git', ['switch', '-c', 'spec/external-capability'], {
        cwd: workspace,
      });
      await execFileAsync('git', ['switch', '-c', 'feature/external-capability'], {
        cwd: appRepository,
      });
      await execFileAsync('git', ['switch', '-c', 'feature/external-capability'], {
        cwd: workerRepository,
      });
      const environment = await createOpenSpecStoreEnvironment(
        root,
        workspace,
        'external-capability',
      );
      const changeRoot = path.join(
        workspace,
        'openspec',
        'changes',
        'external-capability',
      );
      await mkdir(path.join(changeRoot, 'specs', 'external-capability'), { recursive: true });
      await writeFile(path.join(workspace, '.gitignore'), '.repoctopus/\n');
      await writeFile(
        path.join(workspace, 'repoctopus.yaml'),
        JSON.stringify({
          apiVersion: 'repoctopus/v1alpha1',
          kind: 'RepoctopusWorkspace',
          workspace: { id: 'external-capability', repositoryId: 'workspace' },
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
            store: { id: 'external-capability', repositoryId: 'workspace' },
          },
        }),
      );
      await writeFile(
        path.join(changeRoot, 'proposal.md'),
        '# Proposal\n\n## Why\n\nProve Work-scoped capabilities.\n\n## What Changes\n\n- Exercise an external Build Host.\n\n## Capabilities\n\n### New Capabilities\n\n- `external-capability`: add external Build behavior.\n\n### Modified Capabilities\n\n## Impact\n\n- Runtime test only.\n',
      );
      await writeFile(
        path.join(changeRoot, 'design.md'),
        '# Design\n\n## Context\n\nExternal Host.\n\n## Goals / Non-Goals\n\n**Goals:**\n- Prove Work capability ownership.\n\n**Non-Goals:**\n- Add a scheduler.\n\n## Decisions\n\nEach Work declares its own capabilities.\n',
      );
      const taskLines = multiRepository
        ? '- [ ] 1.1 Write app output.\n  **Acceptance:** app output exists\n  **Requirements:** external-capability#external-build\n- [ ] 1.2 Write worker output.\n  **Acceptance:** worker output exists\n  **Requirements:** external-capability#external-build\n'
        : '- [ ] 1.1 Write app output.\n  **Acceptance:** app output exists\n  **Requirements:** external-capability#external-build\n';
      await writeFile(path.join(changeRoot, 'tasks.md'), `# Tasks\n\n${taskLines}`);
      await writeFile(
        path.join(changeRoot, 'specs', 'external-capability', 'spec.md'),
        '# External Capability Delta\n\n## Purpose\n\nProve that each Build Work validates only its own Host capabilities.\n\n## ADDED Requirements\n\n### Requirement: External Build\n\nThe Runtime MUST validate current Work capabilities before claim.\n\n#### Scenario: Minimal Host\n\n- **WHEN** an external Host declares exactly the current Work capabilities\n- **THEN** the Runtime accepts the claim without rebuilding the Binding from that capability list\n',
      );
      await execFileAsync('git', ['add', '.'], { cwd: workspace });
      await execFileAsync('git', ['commit', '-m', 'spec: define external capability acceptance'], {
        cwd: workspace,
      });
      await execFileAsync('git', ['push', '--set-upstream', 'origin', 'spec/external-capability'], {
        cwd: workspace,
      });
      for (const repository of [appRepository, workerRepository]) {
        await execFileAsync(
          'git',
          ['push', '--set-upstream', 'origin', 'feature/external-capability'],
          { cwd: repository },
        );
      }

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
          'external-capability',
          '--target',
          'main',
          '--execution-mode',
          'autonomous',
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
      const planningHost = installCapturingWorkExecutionHost({
        context: application.context,
        workspace,
        repositories: { workspace, app: appRepository, worker: workerRepository },
        operations: () => [],
      });
      let planningHostActive = true;
      const next = () =>
        application.context.commandRouter.execute<
          { runId: string },
          RuntimeResult<RunStatusView>
        >('run.next', { runId });
      const status = () =>
        application.context.commandRouter.execute<{ runId: string }, RunStatusView>(
          'run.status',
          { runId },
        );
      const advanceUntil = async (
        predicate: (view: RunStatusView) => boolean,
        label: string,
      ): Promise<RunStatusView> => {
        for (let step = 0; step < 16; step += 1) {
          const view = await status();
          if (predicate(view)) return view;
          await next();
        }
        throw new Error(`Runtime did not reach ${label}`);
      };
      const approve = async (phase: 'open' | 'design') => {
        const approval = await application.context.commandRouter.execute<
          { changeId: string; approvalPhase: 'open' | 'design' },
          SpecificationApprovalState | null
        >('specification.approval.status', {
          changeId: 'external-capability',
          approvalPhase: phase,
        });
        if (!approval || approval.status !== 'awaiting_approval') {
          throw new Error(`Missing ${phase} approval`);
        }
        await application.context.commandRouter.execute('run.change.decide', {
          runId,
          response: {
            apiVersion: 'repoctopus/v1alpha1',
            kind: 'HumanDecisionResponse',
            requestId: approval.decisionRequest.requestId,
            proposalHash: approval.decisionRequest.proposalHash,
            decision: 'approve',
          },
          actor: { actorId: 'external-host-test-user', source: 'cli', authenticated: true },
          ...(phase === 'open' ? { isolation: 'branch' as const } : {}),
        });
      };
      const claim = (capabilities: readonly string[]) =>
        application.context.managedWorkExecutor.claimExternal({
          runId,
          adapter: 'manual',
          hostCapabilities: capabilities,
          executor,
        });
      const submit = (
        claimed: ExternalWorkClaimResult,
        submissionId: string,
        result: WorkExecutionResult,
      ) =>
        application.context.managedWorkExecutor.acceptExternalOutcome({
          schemaVersion: 3,
          runId,
          submissionId,
          invocationId: claimed.invocation.invocationId,
          hostId: claimed.invocation.host.id,
          packetDigest: claimed.packet.identity.packetDigest,
          status: 'succeeded',
          summary: `External Host completed ${claimed.packet.work.kind}`,
          consumedLayerDigests: consumedLayers(claimed.packet),
          result,
        });

      try {
        await advanceUntil(
          (view) =>
            view.changeLifecycle?.phase === 'open' &&
            view.changeLifecycle.waitCondition?.kind === 'human-decision',
          'Open approval',
        );
        await approve('open');
        await advanceUntil(
          (view) =>
            view.changeLifecycle?.phase === 'design' &&
            view.changeLifecycle.waitCondition?.kind === 'human-decision',
          'Design approval',
        );
        await approve('design');
        await advanceUntil(
          (view) => view.changeLifecycle?.currentWork?.kind === 'build.configure',
          'Build Configure',
        );
        planningHost.dispose();
        planningHostActive = false;

        const configureCapabilities = [
          'build.autonomous',
          'repository.read',
          'specification.read',
        ];
        expect((await status()).changeLifecycle?.currentWork?.capabilities).toEqual(
          configureCapabilities,
        );
        const configure = await claim(configureCapabilities);
        expect(configure.executionAcquired).toBe(true);
        await submit(configure, 'configure-submission-1', {
          schemaVersion: 1,
          kind: 'execution-binding-candidate',
          strategyDigest: changeInputs(configure.packet).build.strategy.semanticDigest,
        });
        await advanceUntil(
          (view) => view.changeLifecycle?.currentWork?.kind === 'build.plan',
          'Build Plan',
        );

        const planCapabilities = [
          'build.autonomous',
          'repository.read',
          'specification.read',
        ];
        expect((await status()).changeLifecycle?.currentWork?.capabilities).toEqual(
          planCapabilities,
        );
        const plan = await claim(planCapabilities);
        const duplicatePlan = await claim(planCapabilities);
        expect(duplicatePlan.invocation.invocationId).toBe(plan.invocation.invocationId);
        expect(duplicatePlan.executionAcquired).toBe(false);
        const planInputs = changeInputs(plan.packet);
        const planResult = {
          schemaVersion: 1,
          kind: 'build-plan-candidate',
          packages: planInputs.tasks.map((task, index) => {
            const repositoryId = multiRepository && index > 0 ? 'worker' : 'app';
            return {
              packageKey: task.taskId,
              taskIds: [task.taskId],
              repositoryIds: [repositoryId],
              writeScopes: [{ repositoryId, paths: ['src/**'] }],
              acceptanceRefs: task.acceptanceCriteria.map((entry) => entry.acceptanceId),
              expectedOutcomes: [`Complete ${task.taskId}`],
              validatorProfile: 'build-package-v1',
              dependsOn: index === 0 ? [] : [planInputs.tasks[index - 1]!.taskId],
            };
          }),
        } satisfies WorkExecutionResult;
        await submit(plan, 'plan-submission-1', planResult);
        await submit(plan, 'plan-submission-1', planResult);

        await application.close();
        application = await bootProjectComposition(productRoot, workspace);
        let afterPlan = await advanceUntil(
          (view) =>
            view.changeLifecycle?.currentWork?.kind === 'build.execute' ||
            view.changeLifecycle?.waitCondition?.kind === 'human-decision',
          'Build Execute or Plan Evidence approval',
        );
        if (afterPlan.changeLifecycle?.waitCondition?.kind === 'human-decision') {
          const wait = afterPlan.changeLifecycle.waitCondition;
          await application.context.commandRouter.execute('run.change.decide', {
            runId,
            response: {
              apiVersion: 'repoctopus/v1alpha1',
              kind: 'HumanDecisionResponse',
              requestId: wait.requestId,
              proposalHash: wait.proposalDigest,
              decision: 'approve',
            },
            actor: { actorId: 'external-host-test-user', source: 'cli', authenticated: true },
          });
          afterPlan = await advanceUntil(
            (view) => view.changeLifecycle?.currentWork?.kind === 'build.execute',
            'Build Execute after Plan Evidence',
          );
        }
        expect(afterPlan.changeLifecycle?.build?.planRevision).toBe(1);

        const executeCapabilities = [
          'build.autonomous',
          'process.execute',
          'repository.read',
          'repository.write',
        ];
        let blockedOnce = false;
        while ((await status()).changeLifecycle?.currentWork?.kind === 'build.execute') {
          expect((await status()).changeLifecycle?.currentWork?.capabilities).toEqual(
            executeCapabilities,
          );
          if (!blockedOnce) {
            blockedOnce = true;
            await expect(
              claim(executeCapabilities.filter((capability) => capability !== 'repository.write')),
            ).rejects.toThrow(/missing repository\.write/u);
            expect((await status()).state.workExecution).toBeUndefined();
          }
          const execution = await claim(executeCapabilities);
          const inputs = changeInputs(execution.packet);
          const currentPackage = inputs.build.currentPackage!;
          const repositoryId = currentPackage.repositoryIds[0]!;
          const checkout = repositoryId === 'worker' ? workerRepository : appRepository;
          await mkdir(path.join(checkout, 'src'), { recursive: true });
          await writeFile(
            path.join(checkout, 'src', `${currentPackage.packageId.replace(':', '-')}.txt`),
            `external package ${currentPackage.packageId}\n`,
          );
          await execFileAsync('git', ['add', 'src'], { cwd: checkout });
          await execFileAsync('git', ['commit', '-m', `feat: complete ${currentPackage.packageId}`], {
            cwd: checkout,
          });
          await execFileAsync('git', ['push'], { cwd: checkout });
          await submit(execution, `execute:${currentPackage.packageId}`, {
            schemaVersion: 1,
            kind: 'build-package-completion',
            packageId: currentPackage.packageId,
            acceptanceEvidenceIds: [`acceptance:${currentPackage.packageId}`],
            testEvidenceIds: [`test:${currentPackage.packageId}`],
            tddEvidence: {
              redEvidenceId: `red:${currentPackage.packageId}`,
              greenEvidenceId: `green:${currentPackage.packageId}`,
              regressionEvidenceId: `regression:${currentPackage.packageId}`,
            },
            implementationDigest: `sha256:${'e'.repeat(64)}`,
          });
          await advanceUntil(
            (view) => view.state.workExecution === undefined,
            'accepted Build package',
          );
          await advanceUntil(
            (view) =>
              view.changeLifecycle?.currentWork?.kind === 'build.execute' ||
              view.changeLifecycle?.currentWork?.kind === 'build.check',
            'next Build Work',
          );
        }

        const checkCapabilities = ['build.autonomous', 'process.execute', 'repository.read'];
        expect((await status()).changeLifecycle?.currentWork).toMatchObject({
          kind: 'build.check',
          capabilities: checkCapabilities,
        });
        const check = await claim(checkCapabilities);
        const checkInputs = changeInputs(check.packet);
        await submit(check, 'check-submission-1', {
          schemaVersion: 1,
          kind: 'build-check-candidate',
          completedPackageIds: checkInputs.build.plan!.packages.map((entry) => entry.packageId),
          acceptedTaskIds: checkInputs.tasks.map((task) => task.taskId),
          testEvidenceIds: ['test:external-build-check'],
          implementationDigest: `sha256:${'f'.repeat(64)}`,
          reviewerExecutionId: check.invocation.invocationId,
        });
        const verifiedBuild = await advanceUntil(
          (view) => view.changeLifecycle?.phase === 'verify',
          'Verify phase',
        );
        expect(verifiedBuild.changeLifecycle?.phase).toBe('verify');

        const inspection = await application.context.commandRouter.execute<
          { runId: string },
          { trajectory: Array<{ type: string; data: Record<string, unknown> }> }
        >('run.inspect', { runId });
        expect(
          inspection.trajectory.filter(
            (event) =>
              event.type === 'change.lifecycle.transitioned' &&
              event.data.observationKind === 'build-binding-revalidation-required',
          ),
        ).toHaveLength(0);
        expect(
          inspection.trajectory.filter((event) => event.type === 'work.claim-rejected'),
        ).toHaveLength(1);
      } finally {
        if (planningHostActive) planningHost.dispose();
        await application.close();
        for (const key of environmentKeys) {
          const value = previousEnvironment[key];
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    },
    300_000,
  );
});
