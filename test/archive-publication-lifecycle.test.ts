import { verificationInputFixture } from './helpers/evidence-inputs.js';
import { createArchiveInputFixture as createArchiveDeliveryInput } from './helpers/evidence-inputs.js';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { bootProjectComposition } from '../app/boot/bootstrap.js';

import {
  createDeliveryPublishWork,
  createSpecificationCloseWork,
} from '../domains/change-lifecycle/archive-input.js';
import { createVerifyWork } from '../domains/change-lifecycle/verify-work.js';
import { createLifecyclePhaseWork } from '../domains/change-lifecycle/phase-work.js';
import {
  BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
  createChangeLifecycleSnapshot,
} from '../domains/change-lifecycle/definition.js';
import { evolveChangeLifecycle } from '../domains/change-lifecycle/transition.js';
import {
  createPublicationReceipt,
  PUBLICATION_RECEIPT_API_VERSION,
} from '../domains/delivery/publication-receipt.js';
import { PublicationResultUnknownError } from '../domains/delivery/publication-result-unknown.js';
import type { DeliveryIntentV3, DeliveryPolicy } from '../domains/delivery/types.js';
import type { SkillUsageSnapshot } from '../domains/skill/types.js';
import type { SpecificationClosureResult } from '../domains/specification/types.js';
import { WorkflowRunCoordinator } from '../domains/runtime/workflow-runs.js';
import type { ResumeView, RunStatusView, RunStorePort } from '../domains/runtime/types.js';
import type { Checkpoint } from '../domains/trajectory/types.js';
import type { RunState } from '../domains/engine/types.js';
import { FileRuntimeStore } from '../platform/runtime/file-runtime-store.js';
import { createSpecificationPhaseContext } from '../services/specification.js';
import { snapshotSkillDefinition } from '../platform/skill/snapshot.js';
import {
  compositionFixture,
  createGitRepository,
  projectFixture,
  removeTemporaryDirectory,
  temporaryDirectory,
  workflowFixture,
} from './helpers/fixtures.js';
import { runCli } from './e2e/cli.js';

const cleanup: string[] = [];
const git = promisify(execFile);
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

async function recordHistoricalReconciliation(
  store: Pick<RunStorePort, 'commitGuarded'>,
  runId: string,
) {
  // Frozen historical fixture for the formerly faulty completed-resume write.
  // Product recovery must keep this fact while projecting the terminal authority.
  await store.commitGuarded(runId, ({ state, trajectory }) => {
    const historical = {
      ...state,
      reconciliationRequired: true,
      stateVersion: state.stateVersion + 1,
    };
    return {
      state: historical,
      event: {
        schemaVersion: 1,
        sequence: trajectory.length + 1,
        eventId: 'historical-terminal-drift',
        timestamp: state.updatedAt,
        type: 'recovery.reconciled',
        runId,
        stateVersion: historical.stateVersion,
        compositionDigest: state.composition.compositionDigest,
        data: { historicalProjectDrift: true },
      },
      value: undefined,
    };
  });
}

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;

const archiveHostCapabilities = [
  'git.publish',
  'platform.mutate',
  'repository.read',
  'specification.write',
] as const;

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

const intent: DeliveryIntentV3 = {
  schemaVersion: 3,
  changeId: 'terminal-archive',
  changeBranch: {
    repositoryId: 'workspace',
    remoteIdentity: 'team/workspace',
    sourceBranch: 'spec/terminal-archive',
    targetBranch: 'main',
    remoteOid: 'a'.repeat(40),
  },
  businessDeliveries: [
    {
      deliveryId: 'primary',
      repositoryId: 'app',
      sourceBranch: 'feature/terminal-archive',
      targetBranch: 'main',
      commitMessage: 'feat: terminal archive',
      actions: ['push', 'merge_request'],
    },
  ],
};

const prSkill: SkillUsageSnapshot = {
  schemaVersion: 1,
  name: 'pr',
  provider: 'matt-builtins',
  invocation: { modelInvocable: true, userInvocable: true },
  contentDigest: digest('1'),
  resourceManifestDigest: digest('2'),
};

const archiveSkill: SkillUsageSnapshot = {
  ...prSkill,
  name: 'repoctopus-archive-change',
};

const designSkill: SkillUsageSnapshot = {
  ...prSkill,
  name: 'repoctopus-design-change',
};

const codebaseDesignSkill: SkillUsageSnapshot = {
  ...prSkill,
  name: 'codebase-design',
};

const verifySkill: SkillUsageSnapshot = {
  ...prSkill,
  name: 'repoctopus-verify-change',
};

const codeReviewSkill: SkillUsageSnapshot = {
  ...prSkill,
  name: 'code-review',
};

function archivePhaseContext(provider: SpecificationClosureResult['provider']) {
  return createSpecificationPhaseContext({
    phase: 'archive',
    provider,
    artifacts: [
      {
        id: 'proposal',
        kind: 'proposal',
        instruction: 'proposal',
        template: '# Proposal',
        instructionDigest: digest('a'),
        templateDigest: digest('b'),
      },
      {
        id: 'specs',
        kind: 'delta-specs',
        instruction: 'specs',
        template: '# Specs',
        instructionDigest: digest('c'),
        templateDigest: digest('d'),
      },
      {
        id: 'design',
        kind: 'design',
        instruction: 'design',
        template: '# Design',
        instructionDigest: digest('e'),
        templateDigest: digest('f'),
      },
      {
        id: 'tasks',
        kind: 'tasks',
        instruction: 'tasks',
        template: '# Tasks',
        instructionDigest: digest('1'),
        templateDigest: digest('2'),
      },
    ],
  });
}

function archiveState(actionSkill: SkillUsageSnapshot = prSkill) {
  const verificationInput = verificationInputFixture('run-terminal', 0, {
    profileId: 'verification',
    fingerprintDigest: digest('8'),
    projectConfigDigest: digest('5'),
    compositionDigest: digest('6'),
  });
  const archive = createArchiveDeliveryInput({
    runId: 'run-terminal',
    changeId: 'terminal-archive',
    verificationInputDigest: verificationInput.digest,
    acceptedEvidenceBundleIds: ['bundle-1'],
    evidenceBundleId: 'bundle-1',
    verificationReport: {
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'ArtifactRef',
      sha256: '4'.repeat(64),
      size: 64,
      mediaType: 'application/json',
      artifactType: 'verification-report',
      redacted: true,
    },
    intent,
    policy,
    planningCompositionDigest: digest('6'),
    evidenceCompositionDigest: digest('6'),
  });
  const initial = {
    ...createChangeLifecycleSnapshot({
      identity: {
        workspaceId: 'team',
        changeId: 'terminal-archive',
        runId: 'run-terminal',
      },
    }),
    phase: 'archive' as const,
    status: 'running' as const,
    planningDigest: digest('f'),
    tasks: [
      {
        taskId: '1.1',
        taskRevision: digest('2'),
        title: 'Close a verified change',
        level: 0,
        status: 'completed' as const,
        completion: { source: 'runtime-work' as const, workId: 'build:1.1:complete' },
        blockedBy: [],
        acceptanceCriteria: [
          {
            acceptanceId: 'acceptance-archive-close' as const,
            taskId: '1.1',
            taskRevision: digest('2'),
            text: 'Verified changes are closed only from fresh Evidence',
            requirementRefs: ['change-lifecycle#archive-close-freshness'],
            source: 'test-fixture',
          },
        ],
        requirementRefs: [],
      },
    ],
    verificationInput,
  };
  const closeWork = createSpecificationCloseWork({
    definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
    checkEpoch: initial.checkEpoch + 1,
    archive,
    actionSkill: archiveSkill,
    workspaceRepositoryId: 'workspace',
    repositoryIds: ['workspace', 'app'],
  });
  const preflight = evolveChangeLifecycle({
    definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
    current: initial,
    observation: { kind: 'archive-preflight-ready', archiveInput: archive, work: closeWork },
  });
  const closure: SpecificationClosureResult = {
    apiVersion: 'repoctopus.specification/v1alpha1',
    kind: 'SpecificationClosureResult',
    changeId: 'terminal-archive',
    provider: {
      id: 'openspec',
      version: '1.14.3',
      protocolVersion: 'repoctopus.specification/v1alpha1',
    },
    planDigest: digest('9'),
    closureId: digest('a'),
    status: 'closed',
    archiveId: '2026-10-24-terminal-archive',
    changedFiles: ['openspec/changes/archive/2026-10-24-terminal-archive/proposal.md'],
    candidate: { checkoutId: 'closure-terminal-archive', baseOid: 'b'.repeat(40) },
  };
  const publishWork = createDeliveryPublishWork({
    definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
    checkEpoch: preflight.snapshot.checkEpoch + 1,
    archive,
    closure,
    actionSkill,
    workspaceRepositoryId: 'workspace',
    repositoryIds: ['workspace', 'app'],
  });
  const closed = evolveChangeLifecycle({
    definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
    current: preflight.snapshot,
    observation: { kind: 'archive-specification-closed', closure, work: publishWork },
  });
  const receipt = createPublicationReceipt({
    apiVersion: PUBLICATION_RECEIPT_API_VERSION,
    kind: 'PublicationReceipt',
    schemaVersion: 2,
    changeId: 'terminal-archive',
    runId: 'run-terminal',
    deliverySnapshotDigest: digest('b'),
    verificationInputDigest: verificationInput.digest,
    evidenceBundleIds: ['bundle-1'],
    specificationClosure: { closureId: closure.closureId, planDigest: closure.planDigest },
    items: [
      {
        publicationId: 'business-primary',
        role: 'business',
        deliveryId: 'primary',
        repositoryId: 'app',
        remoteIdentity: 'team/app',
        remote: 'origin',
        sourceBranch: 'feature/terminal-archive',
        targetBranch: 'main',
        publishedOid: 'c'.repeat(40),
        mergeRequest: {
          provider: 'github',
          repositoryId: 'app',
          number: 41,
          url: 'https://github.com/team/app/pull/41',
        },
        provenance: 'runtime-created',
        verifiedAt: '2026-10-24T00:00:00.000Z',
      },
      {
        publicationId: 'specification',
        role: 'specification',
        repositoryId: 'workspace',
        remoteIdentity: 'team/workspace',
        remote: 'origin',
        sourceBranch: 'spec/terminal-archive',
        targetBranch: 'main',
        publishedOid: 'd'.repeat(40),
        mergeRequest: {
          provider: 'github',
          repositoryId: 'workspace',
          number: 42,
          url: 'https://github.com/team/workspace/pull/42',
        },
        provenance: 'human-created',
        verifiedAt: '2026-10-24T00:00:00.000Z',
      },
    ],
  });
  return {
    initial,
    preflight: preflight.snapshot,
    closed: closed.snapshot,
    archive,
    closure,
    receipt,
  };
}

describe('Archive publication terminal lifecycle', () => {
  it('keeps completed status terminal despite a historical reconciliation flag', async () => {
    const workspace = await temporaryDirectory('repoctopus-terminal-status-');
    cleanup.push(workspace);
    const store = new FileRuntimeStore(workspace);
    const runtime = new WorkflowRunCoordinator(
      store,
      { export: () => Promise.resolve() },
      compositionFixture(),
    );
    const { closed, receipt } = archiveState();
    const runId = closed.identity.runId;
    await runtime.start({
      workflow: workflowFixture(),
      projectSnapshot: projectFixture(),
      runId,
      changeLifecycle: closed,
    });
    await runtime.acceptChangeObservation(runId, {
      kind: 'archive-publication-receipt-accepted',
      receipt,
    });
    await recordHistoricalReconciliation(store, runId);
    const before = await store.loadRun(runId);
    const status = await runtime.status(runId);
    expect(status.continuation).toMatchObject({
      continuation: 'done',
      reason: 'terminal',
      workId: null,
      attempt: null,
    });
    expect(status.changeLifecycle?.nextActions).toEqual([]);
    expect(await store.loadRun(runId)).toEqual(before);
  });

  it.each(['resume-next', 'next-resume'] as const)(
    'preserves terminal coordinator facts in %s order',
    async (order) => {
      const workspace = await temporaryDirectory('repoctopus-terminal-resume-');
      cleanup.push(workspace);
      const store = new FileRuntimeStore(workspace);
      const runtime = new WorkflowRunCoordinator(
        store,
        { export: () => Promise.resolve() },
        compositionFixture(),
      );
      const { closed, receipt } = archiveState();
      const runId = closed.identity.runId;
      const initial = projectFixture({
        root: workspace,
        repositories: [
          {
            id: 'app',
            name: 'app',
            path: path.join(workspace, 'app'),
            remoteIdentity: 'example.com/team/app',
            branch: 'main',
            head: 'a'.repeat(40),
            worktree: { dirty: false, digest: 'clean', staged: 0, unstaged: 0, untracked: 0 },
          },
        ],
      });
      await runtime.start({
        workflow: workflowFixture(),
        projectSnapshot: initial,
        runId,
        changeLifecycle: closed,
      });
      await runtime.acceptChangeObservation(runId, {
        kind: 'archive-publication-receipt-accepted',
        receipt,
      });
      const before = await runtime.status(runId);
      const current = projectFixture({
        repositories: initial.repositories.map((repository) => ({
          ...repository,
          branch: 'feature/completed',
          head: 'f'.repeat(40),
        })),
      });
      for (const entry of order.split('-')) {
        const response =
          entry === 'resume'
            ? await runtime.resume({ runId, currentProjectSnapshot: current })
            : await runtime.next(runId);
        expect(response.value.continuation).toMatchObject({
          continuation: 'done',
          reason: 'terminal',
        });
        expect(response.value.state).toEqual(before.state);
        expect(response.value.checkpoint).toEqual(before.checkpoint);
        expect(response.value.trajectoryLength).toBe(before.trajectoryLength);
      }
    },
  );

  it.each(['after-trajectory', 'after-run'] as const)(
    'recovers the original completed transition interrupted %s and exports it once',
    async (point) => {
      const workspace = await temporaryDirectory('repoctopus-terminal-journal-');
      cleanup.push(workspace);
      let interrupt = false;
      const fault = () => {
        if (interrupt) {
          interrupt = false;
          throw new Error('terminal write interrupted');
        }
      };
      const store = new FileRuntimeStore(workspace, {
        ...(point === 'after-trajectory'
          ? { afterTrajectoryWritten: fault }
          : { afterRunWritten: fault }),
      });
      const telemetry = { export: vi.fn(() => Promise.resolve()) };
      const runtime = new WorkflowRunCoordinator(store, telemetry, compositionFixture());
      const { closed, receipt } = archiveState();
      const runId = closed.identity.runId;
      await runtime.start({
        workflow: workflowFixture(),
        projectSnapshot: projectFixture(),
        runId,
        changeLifecycle: closed,
      });
      telemetry.export.mockClear();
      interrupt = true;
      await expect(
        runtime.acceptChangeObservation(runId, {
          kind: 'archive-publication-receipt-accepted',
          receipt,
        }),
      ).rejects.toThrow('terminal write interrupted');
      const fresh = new WorkflowRunCoordinator(
        new FileRuntimeStore(workspace),
        telemetry,
        compositionFixture(),
      );
      const resumed = await fresh.resume({ runId, currentProjectSnapshot: projectFixture() });
      expect(resumed.value).toMatchObject({
        state: { status: 'completed' },
        continuation: { continuation: 'done' },
      });
      expect(resumed.value.state.changeLifecycle?.publicationReceipt).toEqual(receipt);
      expect(telemetry.export).toHaveBeenCalledTimes(1);
      const before = await fresh.status(runId);
      await fresh.next(runId);
      await fresh.resume({ runId, currentProjectSnapshot: projectFixture() });
      expect(telemetry.export).toHaveBeenCalledTimes(1);
      expect(await fresh.status(runId)).toEqual(before);
    },
  );

  it.each([
    'missing-checkpoint',
    'missing-trajectory',
    'invalid-run',
    'stale-checkpoint',
    'wrong-checkpoint-status',
    'missing-snapshot',
    'invalid-snapshot',
    'mismatched-snapshot',
    'wrong-run-status',
  ] as const)('rejects unverified completed persistence: %s', async (fault) => {
    const workspace = await temporaryDirectory('repoctopus-terminal-integrity-');
    cleanup.push(workspace);
    const store = new FileRuntimeStore(workspace);
    const runtime = new WorkflowRunCoordinator(
      store,
      { export: () => Promise.resolve() },
      compositionFixture(),
    );
    const { closed, receipt } = archiveState();
    const runId = closed.identity.runId;
    await runtime.start({
      workflow: workflowFixture(),
      projectSnapshot: projectFixture(),
      runId,
      changeLifecycle: closed,
    });
    await runtime.acceptChangeObservation(runId, {
      kind: 'archive-publication-receipt-accepted',
      receipt,
    });
    const files = store.paths(runId);
    if (fault === 'missing-checkpoint') await unlink(files.checkpoint);
    else if (fault === 'missing-trajectory') await unlink(files.trajectory);
    else if (fault === 'invalid-run') await writeFile(files.run, '{invalid');
    else if (fault === 'missing-snapshot') await unlink(files.projectSnapshot);
    else if (fault === 'invalid-snapshot') await writeFile(files.projectSnapshot, '{invalid');
    else if (fault === 'mismatched-snapshot')
      await writeFile(
        files.projectSnapshot,
        JSON.stringify({ ...projectFixture(), digest: 'wrong' }),
      );
    else if (fault === 'wrong-run-status') {
      const state = JSON.parse(await readFile(files.run, 'utf8')) as RunState;
      state.status = 'running';
      await writeFile(files.run, JSON.stringify(state));
    } else {
      const checkpoint = JSON.parse(await readFile(files.checkpoint, 'utf8')) as Checkpoint;
      if (fault === 'stale-checkpoint') checkpoint.stateVersion -= 1;
      else checkpoint.runStatus = 'running';
      await writeFile(files.checkpoint, JSON.stringify(checkpoint));
    }
    for (const recover of [
      () => runtime.status(runId),
      () => runtime.next(runId),
      () => runtime.resume({ runId, currentProjectSnapshot: projectFixture() }),
    ])
      await expect(recover()).rejects.toThrow(/checkpoint|trajectory|JSON|ENOENT/iu);
  });

  it.each([
    ['resume-next', 'service', false],
    ['next-resume', 'service', false],
    ['resume-next', 'cli', false],
    ['next-resume', 'cli', false],
    ['resume-next', 'cli', true],
    ['next-resume', 'cli', true],
  ] as const)(
    'keeps completed recovery terminal in %s order via %s (historical flag: %s)',
    async (order, entrypoint, historicalFlag) => {
      const root = await temporaryDirectory('repoctopus-terminal-service-');
      cleanup.push(root);
      const workspace = await createGitRepository(root, 'workspace');
      const business = await createGitRepository(root, 'app');
      await writeFile(
        path.join(workspace, 'repoctopus.yaml'),
        JSON.stringify({
          apiVersion: 'repoctopus/v1alpha1',
          kind: 'RepoctopusWorkspace',
          workspace: { id: 'team', repositoryId: 'workspace' },
          repositories: [
            { id: 'workspace', path: '.' },
            { id: 'app', path: '../app' },
          ],
          profiles: [
            {
              id: 'verification',
              nodes: [
                {
                  id: 'check',
                  type: 'command',
                  repository: 'app',
                  executable: process.execPath,
                  args: ['-e', 'process.exit(0)'],
                  covers: ['*'],
                },
              ],
            },
          ],
        }),
      );
      const app = await bootProjectComposition(path.resolve(import.meta.dirname, '..'), workspace);
      try {
        const snapshotInput = {
          workspaceId: 'team',
          workspaceRoot: workspace,
          workspaceRepositoryId: 'workspace',
          repositories: [
            { id: 'workspace', path: workspace },
            { id: 'app', path: business },
          ],
        };
        const initial = await app.context.project.snapshot(snapshotInput);
        const runtime = new WorkflowRunCoordinator(
          app.context.runStore,
          { export: () => Promise.resolve() },
          app.context.compositionIdentity.current(),
        );
        const { closed, receipt } = archiveState();
        const runId = closed.identity.runId;
        await runtime.start({
          workflow: workflowFixture(),
          projectSnapshot: initial,
          runId,
          changeLifecycle: closed,
        });
        await runtime.acceptChangeObservation(runId, {
          kind: 'archive-publication-receipt-accepted',
          receipt,
        });
        if (historicalFlag) await recordHistoricalReconciliation(app.context.runStore, runId);
        const before = await runtime.status(runId);
        await git('git', ['switch', '-c', 'feature/completed'], { cwd: business });
        await writeFile(
          path.join(business, 'completed.txt'),
          'Authorized implementation completed.\n',
        );
        await git('git', ['add', 'completed.txt'], { cwd: business });
        await git('git', ['commit', '-m', 'test: completed implementation'], { cwd: business });
        const current = await app.context.project.snapshot(snapshotInput);
        const observeProject = vi.spyOn(app.context.project, 'snapshot');
        const getSkill = vi.spyOn(app.context.skills, 'get');
        const close = vi.spyOn(app.context.specification, 'close');
        const publish = vi.spyOn(app.context.delivery, 'publishArchive');
        for (const entry of order.split('-')) {
          const response = await (async () => {
            if (entrypoint === 'service')
              return entry === 'resume'
                ? app.context.workflowRuns.resume({ runId, currentProjectSnapshot: current })
                : app.context.workflowRuns.next(runId);
            const envelope = await runCli<ResumeView | RunStatusView>({
              packageRoot: path.resolve(import.meta.dirname, '..'),
              cwd: workspace,
              args: ['run', entry, '--workspace', workspace, '--run', runId],
            });
            expect(envelope.ok).toBe(true);
            expect(envelope.nextActions).toEqual([]);
            return { value: envelope.result!, diagnostics: envelope.diagnostics };
          })();
          expect(response.value.continuation).toMatchObject({
            continuation: 'done',
            reason: 'terminal',
          });
          expect(response.value.state).toEqual(before.state);
          expect(response.value.checkpoint).toEqual(before.checkpoint);
          expect(response.value.trajectoryLength).toBe(before.trajectoryLength);
          if (entry === 'resume')
            expect(response.value).toMatchObject({
              execution: { continuation: 'done', reason: 'terminal' },
            });
        }
        expect(observeProject).not.toHaveBeenCalled();
        expect(getSkill).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
      } finally {
        vi.restoreAllMocks();
        await app.close();
      }
    },
  );

  it('returns an unstarted Archive checkpoint directly to a revision-bound Design Work', () => {
    const { initial } = archiveState();
    const work = createLifecyclePhaseWork({
      runId: initial.identity.runId,
      checkEpoch: initial.checkEpoch + 1,
      changeId: initial.identity.changeId,
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      kind: 'specification.plan',
      actionSkill: designSkill,
      augmentationSkills: [codebaseDesignSkill],
      compositionDigest: digest('6'),
      projectSnapshotDigest: digest('7'),
      projectConfigDigest: digest('5'),
      workspaceRepositoryId: 'workspace',
      repositoryIds: ['workspace', 'app'],
    });
    const revised = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: initial,
      observation: {
        kind: 'planning-authority-invalidated',
        expectedRevision: initial.revision,
        fromPhase: 'archive',
        invalidationKind: 'approval-authority',
        reason: 'Design approval no longer authorizes the planning snapshot',
        evidenceIds: [digest('8')],
        inputDigest: digest('f'),
        work,
      },
    });

    expect(revised.snapshot).toMatchObject({
      phase: 'design',
      status: 'running',
      currentWork: { workId: work.workId, kind: 'specification.plan' },
      tasks: [{ taskId: '1.1' }],
    });
    expect(revised.snapshot.planningDigest).toBeUndefined();
    expect(revised.snapshot.verificationInput).toBeUndefined();
    expect(revised.snapshot.archiveDeliveryInput).toBeUndefined();
  });

  it('returns a frozen specification.close Work to Verify before closure side effects', () => {
    const { preflight } = archiveState();
    const verificationInput = verificationInputFixture(
      preflight.identity.runId,
      preflight.checkEpoch + 1,
      { fingerprintDigest: digest('c') },
    );
    const work = createVerifyWork({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      checkEpoch: preflight.checkEpoch + 1,
      verification: verificationInput,
      actionSkill: verifySkill,
      augmentationSkills: [codeReviewSkill],
      workspaceRepositoryId: 'workspace',
      repositoryIds: ['workspace', 'app'],
    });

    const result = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: preflight,
      observation: {
        kind: 'archive-reverify-required',
        reason: 'Verification input changed after Archive Work was frozen',
        verificationInput,
        work,
      },
    });

    expect(result.snapshot).toMatchObject({
      phase: 'verify',
      status: 'running',
      checkEpoch: preflight.checkEpoch + 1,
      currentWork: { workId: work.workId, kind: 'evidence.verify' },
      verificationInput: { digest: verificationInput.digest },
    });
    expect(result.snapshot.archiveDeliveryInput).toBeUndefined();
    expect(result.snapshot.specificationClosure).toBeUndefined();
    expect(result.fact).toMatchObject({
      transitionId: 'archive.reverify',
      from: { phase: 'archive', checkEpoch: preflight.checkEpoch },
      to: { phase: 'verify', checkEpoch: preflight.checkEpoch + 1 },
    });
  });

  it('rebinds only the approved Change branch publication identity before publication and preserves the closure', () => {
    const { closed, archive, closure } = archiveState();
    const correctedArchive = createArchiveDeliveryInput({
      runId: archive.runId,
      changeId: archive.changeId,
      verificationInputDigest: archive.verificationInputDigest,
      acceptedEvidenceBundleIds: [archive.evidenceBundleId],
      evidenceBundleId: archive.evidenceBundleId,
      verificationReport: archive.verificationReport,
      intent: {
        ...intent,
        changeBranch: { ...intent.changeBranch, remoteOid: closure.candidate.baseOid },
      },
      policy,
      planningCompositionDigest: digest('6'),
      evidenceCompositionDigest: digest('6'),
    });
    const work = createDeliveryPublishWork({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      checkEpoch: closed.checkEpoch + 1,
      archive: correctedArchive,
      closure,
      actionSkill: prSkill,
      workspaceRepositoryId: 'workspace',
      repositoryIds: ['workspace', 'app'],
    });
    const corrected = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: closed,
      observation: {
        kind: 'archive-intent-corrected',
        priorArchiveInputDigest: archive.digest,
        archiveInput: correctedArchive,
        closure,
        work,
        reason: 'approved remote OID differs from the frozen input',
      },
    });
    expect(corrected.snapshot).toMatchObject({
      phase: 'archive',
      status: 'running',
      checkEpoch: closed.checkEpoch + 1,
      currentWork: { kind: 'delivery.publish', checkEpoch: closed.checkEpoch + 1 },
      archiveDeliveryInput: {
        changeBranch: { remoteOid: closure.candidate.baseOid },
      },
      specificationClosure: { closureId: closure.closureId },
    });

    const identityCorrectedArchive = createArchiveDeliveryInput({
      publicationCheckpoint: archive.publicationCheckpoint,
      runId: archive.runId,
      changeId: archive.changeId,
      verificationInputDigest: archive.verificationInputDigest,
      acceptedEvidenceBundleIds: [archive.evidenceBundleId],
      evidenceBundleId: archive.evidenceBundleId,
      verificationReport: archive.verificationReport,
      intent: {
        ...intent,
        changeBranch: {
          ...intent.changeBranch,
          remoteIdentity: 'github.com/team/workspace',
          remoteOid: closure.candidate.baseOid,
        },
      },
      policy,
      planningCompositionDigest: digest('6'),
      evidenceCompositionDigest: digest('6'),
    });
    const identityCorrectionWork = createDeliveryPublishWork({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      checkEpoch: closed.checkEpoch + 1,
      archive: identityCorrectedArchive,
      closure,
      actionSkill: prSkill,
      workspaceRepositoryId: 'workspace',
      repositoryIds: ['workspace', 'app'],
    });
    const identityCorrected = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: closed,
      observation: {
        kind: 'archive-intent-corrected',
        priorArchiveInputDigest: archive.digest,
        archiveInput: identityCorrectedArchive,
        closure,
        work: identityCorrectionWork,
        reason: 'approved canonical remote identity replaces the configuration alias',
      },
    });
    expect(identityCorrected.snapshot.archiveDeliveryInput?.changeBranch).toMatchObject({
      remoteIdentity: 'github.com/team/workspace',
      remoteOid: closure.candidate.baseOid,
    });

    expect(() =>
      evolveChangeLifecycle({
        definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
        current: closed,
        observation: {
          kind: 'archive-intent-corrected',
          priorArchiveInputDigest: archive.digest,
          archiveInput: {
            ...correctedArchive,
            businessDeliveries: [
              { ...correctedArchive.businessDeliveries[0]!, targetBranch: 'release' },
            ],
          },
          closure,
          work,
          reason: 'invalid broad correction',
        },
      }),
    ).toThrow(/correction is not valid/u);
  });

  it('returns a local-only closed Archive to Design when the live planning branch drifts', () => {
    const { closed, archive, closure } = archiveState();
    const work = {
      ...closed.currentWork!,
      workId: 'design:archive-drift',
      checkEpoch: closed.checkEpoch + 1,
      phase: 'design' as const,
      kind: 'specification.plan',
      inputDigest: digest('f'),
    };
    const revised = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: closed,
      observation: {
        kind: 'planning-authority-invalidated',
        expectedRevision: closed.revision,
        fromPhase: 'archive',
        invalidationKind: 'semantic',
        work,
        inputDigest: digest('e'),
        reason: 'live Change branch advanced before remote publication',
        evidenceIds: [archive.digest, closure.closureId],
      },
    });
    expect(revised.snapshot).toMatchObject({
      phase: 'design',
      status: 'running',
      checkEpoch: closed.checkEpoch + 1,
      currentWork: { kind: 'specification.plan' },
      tasks: closed.tasks,
    });
    expect(revised.snapshot.archiveDeliveryInput).toBeUndefined();
    expect(revised.snapshot.specificationClosure).toBeUndefined();
    expect(revised.snapshot.verificationInput).toBeUndefined();
    expect(revised.fact?.invalidation).toMatchObject({
      kind: 'planning-authority-invalidated',
      invalidationKind: 'semantic',
      supersededWorkId: closed.currentWork?.workId,
    });
  });

  it('recreates publication Work after an explicitly compatible definition recovery', () => {
    const { closed } = archiveState();
    const recovered = {
      ...closed,
      status: 'running' as const,
      currentWork: null,
      blocker: null,
    };
    const work = {
      ...closed.currentWork!,
      workId: 'archive:restored-publication',
      checkEpoch: recovered.checkEpoch + 1,
    };
    const restored = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: recovered,
      observation: {
        kind: 'archive-work-restored',
        work,
        reason: 'compatible definition patch restored the interrupted Work',
      },
    });
    expect(restored.snapshot).toMatchObject({
      phase: 'archive',
      status: 'running',
      checkEpoch: recovered.checkEpoch + 1,
      currentWork: { workId: work.workId, kind: 'delivery.publish' },
      specificationClosure: closed.specificationClosure,
      archiveDeliveryInput: closed.archiveDeliveryInput,
    });
  });

  it.each(['open', 'merged', 'closed'] as const)(
    'completes from a full receipt without consulting an MR in %s state',
    () => {
      const { closed, receipt } = archiveState();
      const result = evolveChangeLifecycle({
        definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
        current: closed,
        observation: { kind: 'archive-publication-receipt-accepted', receipt },
      });
      expect(result.snapshot).toMatchObject({
        phase: 'archive',
        status: 'completed',
        currentWork: null,
        publicationReceipt: { digest: receipt.digest },
      });
      const repeated = evolveChangeLifecycle({
        definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
        current: result.snapshot,
        observation: { kind: 'archive-publication-receipt-accepted', receipt },
      });
      expect(repeated).toEqual({ snapshot: result.snapshot, fact: null });
    },
  );

  it('blocks when the publication receipt is missing and rejects an incomplete receipt', () => {
    const { closed, receipt } = archiveState();
    const blocked = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: closed,
      observation: {
        kind: 'archive-publication-blocked',
        reason: 'Specification publication was not observed',
        evidenceIds: ['publication:specification'],
      },
    });
    expect(blocked.snapshot).toMatchObject({
      status: 'blocked',
      currentWork: null,
      blocker: { code: 'publication-receipt-incomplete' },
    });
    expect(() =>
      createPublicationReceipt({
        ...receipt,
        items: receipt.items.filter((item) => item.role === 'business'),
      }),
    ).toThrow(/Business and Specification publications/u);
  });

  it('persists the closure and Publication Receipt as the completed Run authority', async () => {
    const workspace = await temporaryDirectory('repoctopus-archive-receipt-');
    cleanup.push(workspace);
    const store = new FileRuntimeStore(workspace);
    const runtime = new WorkflowRunCoordinator(
      store,
      { export: () => Promise.resolve() },
      compositionFixture(),
    );
    const { closed, receipt } = archiveState();
    await runtime.start({
      workflow: workflowFixture(),
      projectSnapshot: projectFixture(),
      runId: closed.identity.runId,
      changeLifecycle: closed,
    });

    await runtime.acceptChangeObservation(closed.identity.runId, {
      kind: 'archive-publication-receipt-accepted',
      receipt,
    });

    const persisted = await store.loadRun(closed.identity.runId);
    expect(persisted).toMatchObject({
      status: 'completed',
      changeLifecycle: {
        specificationClosure: { closureId: receipt.specificationClosure.closureId },
        publicationReceipt: { digest: receipt.digest },
      },
    });
    const status = await runtime.status(closed.identity.runId);
    expect(status.changeLifecycle).toMatchObject({
      status: 'completed',
      publicationReceipt: { digest: receipt.digest },
    });
    expect(status.changeLifecycle?.nextActions).toEqual([]);
  });

  it.each(['source', 'derived'])(
    'revalidates %s inputs before consulting the frozen Close Host outcome',
    async (driftKind) => {
      const root = await temporaryDirectory('repoctopus-archive-close-stale-');
      cleanup.push(root);
      const workspace = await createGitRepository(root, 'workspace');
      await writeFile(
        path.join(workspace, 'repoctopus.yaml'),
        JSON.stringify({
          apiVersion: 'repoctopus/v1alpha1',
          kind: 'RepoctopusWorkspace',
          workspace: { id: 'archive-close-stale', repositoryId: 'workspace' },
          repositories: [{ id: 'workspace', path: '.' }],
          profiles: [
            {
              id: 'verification',
              nodes: [
                {
                  id: 'check',
                  type: 'command',
                  repository: 'workspace',
                  executable: process.execPath,
                  args: ['-e', 'process.exit(0)'],
                  covers: ['*'],
                },
              ],
            },
          ],
        }),
      );
      const app = await bootProjectComposition(path.resolve(import.meta.dirname, '..'), workspace);
      try {
        // These focused protocol fixtures begin at Archive without a Build binding.
        // The real binding boundary is exercised by managed-change-execution.e2e.
        vi.spyOn(
          app.context.workflowRuns as unknown as {
            assertEvidenceWorkspaceAuthorityCurrent: () => Promise<void>;
          },
          'assertEvidenceWorkspaceAuthorityCurrent',
        ).mockResolvedValue();
        const archiveDefinition = await app.context.skills.get('repoctopus-archive-change', {
          cwd: workspace,
        });
        if (!archiveDefinition) throw new Error('Expected Archive Skill');
        const boundArchiveSkill = await snapshotSkillDefinition(archiveDefinition);
        const { preflight, closure } = archiveState();
        const coordinateProject = projectFixture({
          root: workspace,
          repositories: preflight.archiveDeliveryInput!.publicationCheckpoint.repositories.map(
            (repo) => ({
              id: repo.repositoryId,
              name: repo.repositoryId,
              path: workspace,
              remoteIdentity: repo.remoteIdentity,
              branch: repo.branch,
              head: repo.head,
              worktree: { dirty: false, digest: 'clean', staged: 0, unstaged: 0, untracked: 0 },
            }),
          ),
        });
        vi.spyOn(app.context.project, 'snapshot').mockResolvedValue(coordinateProject);
        const project = {
          ...projectFixture(),
          root: workspace,
          repositories: [
            {
              ...projectFixture().repositories[0]!,
              id: 'workspace',
              name: 'workspace',
              path: workspace,
              remoteIdentity: 'team/workspace',
            },
          ],
        };
        const runtime = new WorkflowRunCoordinator(
          app.context.runStore,
          { export: () => Promise.resolve() },
          app.context.compositionIdentity.current(),
        );
        await runtime.start({
          workflow: workflowFixture(),
          projectSnapshot: project,
          runId: preflight.identity.runId,
          trigger: {
            schemaVersion: 1,
            kind: 'change',
            identityDigest: digest('4'),
            facts: {
              projectConfigDigest: digest('5'),
              specificationRoot: { repositoryId: 'workspace' },
            },
          },
          changeLifecycle: {
            ...preflight,
            currentWork: { ...preflight.currentWork!, actionSkill: boundArchiveSkill },
          },
        });
        await runtime.bindSkill(preflight.identity.runId, boundArchiveSkill);
        vi.spyOn(app.context.specification, 'phaseContext').mockResolvedValue(
          archivePhaseContext(closure.provider),
        );
        const observedEvidence = await app.context.evidenceCoordinator.plan('verification');
        if (driftKind === 'derived')
          observedEvidence.fingerprint.digest =
            preflight.verificationInput!.evidenceProfile.fingerprintDigest;
        vi.spyOn(app.context.evidenceCoordinator, 'assessBundleInputs').mockResolvedValue('drift');
        vi.spyOn(app.context.evidenceCoordinator, 'plan').mockResolvedValue(observedEvidence);
        const staleWorkId = preflight.currentWork!.workId;
        const claim = await app.context.managedWorkExecutor.claimExternal({
          runId: preflight.identity.runId,
          adapter: 'specification',
          hostCapabilities: archiveHostCapabilities,
          executor: {
            actorId: 'archive-user',
            runnerId: 'archive-runner',
            source: 'runner',
            authenticated: true,
          },
        });
        await app.context.managedWorkExecutor.acceptExternalOutcome({
          schemaVersion: 3,
          runId: preflight.identity.runId,
          submissionId: 'stale-specification-close-submission',
          invocationId: claim.invocation.invocationId,
          hostId: claim.invocation.host.id,
          packetDigest: claim.packet.identity.packetDigest,
          status: 'succeeded',
          summary: 'Stale close protocol consumed',
          consumedLayerDigests: claim.packet.context.layers
            .filter((layer) => ['action-skill', 'augmentation-skill'].includes(layer.kind))
            .map((layer) => layer.digest),
        });
        await app.context.workExecutionAuthority.markValidated({
          intent: await app.context.workExecutionAuthority.loadIntent(preflight.identity.runId),
          validatorId: preflight.currentWork!.validatorProfile.id,
          continuation: 'execute',
        });
        expect(
          (await app.context.runStore.loadRun(preflight.identity.runId)).workExecution,
        ).toMatchObject({ workId: staleWorkId, status: 'validated' });
        const prepareClosure = vi.spyOn(app.context.specification, 'prepareClosure');
        const close = vi.spyOn(app.context.specification, 'close');

        const result = await app.context.workflowRuns.executeArchiveDelivery({
          runId: preflight.identity.runId,
          project,
          policy,
          executor: {
            actorId: 'archive-user',
            runnerId: 'archive-runner',
            source: 'runner',
            authenticated: true,
          },
        });

        expect(result.value).toMatchObject({
          stage: 'reverify-required',
          publication: null,
          receipt: null,
          run: {
            changeLifecycle: {
              phase: 'verify',
              currentWork: { kind: 'evidence.verify' },
            },
          },
        });
        expect(result.value.run.changeLifecycle?.archiveDeliveryInput).toBeUndefined();
        expect(
          (await app.context.runStore.loadRun(preflight.identity.runId)).workExecution,
        ).toBeUndefined();
        expect(
          (await app.context.runStore.inspect(preflight.identity.runId)).trajectory.some(
            (event) => event.type === 'work.outcome-accepted' && event.data.workId === staleWorkId,
          ),
        ).toBe(true);
        expect(prepareClosure).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    },
  );

  it('requires managed Host outcomes for specification.close before creating delivery.publish', async () => {
    const root = await temporaryDirectory('repoctopus-archive-close-managed-');
    cleanup.push(root);
    const workspace = await createGitRepository(root, 'workspace');
    await writeFile(
      path.join(workspace, 'repoctopus.yaml'),
      JSON.stringify({
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'RepoctopusWorkspace',
        workspace: { id: 'archive-close', repositoryId: 'workspace' },
        repositories: [{ id: 'workspace', path: '.' }],
        profiles: [
          {
            id: 'verification',
            nodes: [
              {
                id: 'check',
                type: 'command',
                repository: 'workspace',
                executable: process.execPath,
                args: ['-e', 'process.exit(0)'],
              },
            ],
          },
        ],
      }),
    );
    const app = await bootProjectComposition(path.resolve(import.meta.dirname, '..'), workspace);
    try {
      const assessBundleInputs = vi
        .spyOn(app.context.evidenceCoordinator, 'assessBundleInputs')
        .mockResolvedValue('same');
      // These focused protocol fixtures begin at Archive without a Build binding.
      // The real binding boundary is exercised by managed-change-execution.e2e.
      vi.spyOn(
        app.context.workflowRuns as unknown as {
          assertEvidenceWorkspaceAuthorityCurrent: () => Promise<void>;
        },
        'assertEvidenceWorkspaceAuthorityCurrent',
      ).mockResolvedValue();
      const archiveDefinition = await app.context.skills.get('repoctopus-archive-change', {
        cwd: workspace,
      });
      if (!archiveDefinition) throw new Error('Expected Archive Skill');
      const boundArchiveSkill = await snapshotSkillDefinition(archiveDefinition);
      const { preflight, closure } = archiveState();
      const coordinateProject = projectFixture({
        root: workspace,
        repositories: preflight.archiveDeliveryInput!.publicationCheckpoint.repositories.map(
          (repo) => ({
            id: repo.repositoryId,
            name: repo.repositoryId,
            path: workspace,
            remoteIdentity: repo.remoteIdentity,
            branch: repo.branch,
            head: repo.head,
            worktree: { dirty: false, digest: 'clean', staged: 0, unstaged: 0, untracked: 0 },
          }),
        ),
      });
      vi.spyOn(app.context.project, 'snapshot').mockResolvedValue(coordinateProject);
      const project = {
        ...projectFixture(),
        root: workspace,
        repositories: [
          {
            ...projectFixture().repositories[0]!,
            id: 'workspace',
            name: 'workspace',
            path: workspace,
            remoteIdentity: 'team/workspace',
          },
        ],
      };
      const runtime = new WorkflowRunCoordinator(
        app.context.runStore,
        { export: () => Promise.resolve() },
        app.context.compositionIdentity.current(),
      );
      await runtime.start({
        workflow: workflowFixture(),
        projectSnapshot: project,
        runId: preflight.identity.runId,
        changeLifecycle: {
          ...preflight,
          currentWork: {
            ...preflight.currentWork!,
            actionSkill: boundArchiveSkill,
          },
        },
      });
      await runtime.bindSkill(preflight.identity.runId, boundArchiveSkill);
      const currentEvidence = await app.context.evidenceCoordinator.plan('verification');
      vi.spyOn(app.context.evidenceCoordinator, 'plan').mockResolvedValue({
        ...currentEvidence,
        fingerprint: { ...currentEvidence.fingerprint, digest: digest('8') },
      });
      vi.spyOn(app.context.specification, 'prepareClosure').mockResolvedValue({
        apiVersion: 'repoctopus.specification/v1alpha1',
        kind: 'SpecificationClosurePlan',
        sourceOid: 'a'.repeat(40),
        changeId: closure.changeId,
        provider: closure.provider,
        mergeFactsDigest: digest('d'),
        targetBaselineDigest: digest('e'),
        changeDigest: digest('f'),
        affectedCapabilities: [],
        retiredCapabilities: [],
        allowedPathPrefixes: ['openspec/changes/archive/**'],
        planDigest: closure.planDigest,
      });
      vi.spyOn(app.context.specification, 'close').mockResolvedValue(closure);
      vi.spyOn(app.context.specification, 'phaseContext').mockResolvedValue(
        archivePhaseContext(closure.provider),
      );
      await expect(
        app.context.workflowRuns.executeArchiveDelivery({
          runId: preflight.identity.runId,
          project,
          policy,
          executor: {
            actorId: 'archive-user',
            runnerId: 'archive-runner',
            source: 'runner',
            authenticated: true,
          },
        }),
      ).rejects.toThrow(/managed Host Outcome/u);
      const claim = await app.context.managedWorkExecutor.claimExternal({
        runId: preflight.identity.runId,
        adapter: 'specification',
        hostCapabilities: archiveHostCapabilities,
        executor: {
          actorId: 'archive-user',
          runnerId: 'archive-runner',
          source: 'runner',
          authenticated: true,
        },
      });
      await app.context.managedWorkExecutor.acceptExternalOutcome({
        schemaVersion: 3,
        runId: preflight.identity.runId,
        submissionId: 'specification-close-submission',
        invocationId: claim.invocation.invocationId,
        hostId: claim.invocation.host.id,
        packetDigest: claim.packet.identity.packetDigest,
        status: 'succeeded',
        summary: 'Close protocol consumed',
        consumedLayerDigests: claim.packet.context.layers
          .filter((layer) => ['action-skill', 'augmentation-skill'].includes(layer.kind))
          .map((layer) => layer.digest),
      });
      // A commit after the outer preflight must be rejected inside the effect fence.
      const frozenState = await app.context.runStore.loadRun(preflight.identity.runId);
      const effect = vi.fn(() => Promise.resolve());
      vi.spyOn(app.context.project, 'snapshot').mockResolvedValueOnce({
        ...coordinateProject,
        repositories: coordinateProject.repositories.map((repo) => ({
          ...repo,
          head: 'f'.repeat(40),
        })),
      });
      await expect(
        (
          app.context.workflowRuns as unknown as {
            withArchiveEffectAuthority: (
              state: typeof frozenState,
              effect: () => Promise<void>,
            ) => Promise<void>;
          }
        ).withArchiveEffectAuthority(frozenState, effect),
      ).rejects.toThrow(/checkpoint changed/u);
      expect(effect).not.toHaveBeenCalled();
      // Drift after the outer observation is fenced immediately before the effect.
      assessBundleInputs.mockResolvedValueOnce('drift');
      await expect(
        (
          app.context.workflowRuns as unknown as {
            withArchiveEffectAuthority: (
              state: typeof frozenState,
              effect: () => Promise<void>,
            ) => Promise<void>;
          }
        ).withArchiveEffectAuthority(frozenState, effect),
      ).rejects.toThrow(/derived inputs changed/u);
      expect(effect).not.toHaveBeenCalled();
      const result = await app.context.workflowRuns.executeArchiveDelivery({
        runId: preflight.identity.runId,
        project,
        policy,
        executor: {
          actorId: 'archive-user',
          runnerId: 'archive-runner',
          source: 'runner',
          authenticated: true,
        },
      });
      expect(result.value).toMatchObject({
        stage: 'specification-closed',
        publication: null,
        receipt: null,
        run: { changeLifecycle: { currentWork: { kind: 'delivery.publish' } } },
      });
    } finally {
      await app.close();
    }
  });

  it('resumes production Archive orchestration from delivery.publish after specification publication fails', async () => {
    const root = await temporaryDirectory('repoctopus-archive-orchestration-');
    cleanup.push(root);
    const workspace = await createGitRepository(root, 'workspace');
    await writeFile(
      path.join(workspace, 'repoctopus.yaml'),
      JSON.stringify({
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'RepoctopusWorkspace',
        workspace: { id: 'archive-recovery', repositoryId: 'workspace' },
        repositories: [{ id: 'workspace', path: '.' }],
        profiles: [
          {
            id: 'verify',
            nodes: [
              {
                id: 'check',
                type: 'command',
                repository: 'workspace',
                executable: process.execPath,
                args: ['-e', 'process.exit(0)'],
              },
            ],
          },
        ],
      }),
    );
    const productRoot = path.resolve(import.meta.dirname, '..');
    const app = await bootProjectComposition(productRoot, workspace);
    try {
      // This protocol fixture supplies no Build binding; the production boundary
      // is covered by the real multi-repository managed execution test.
      vi.spyOn(
        app.context.workflowRuns as unknown as {
          assertEvidenceWorkspaceAuthorityCurrent: () => Promise<void>;
        },
        'assertEvidenceWorkspaceAuthorityCurrent',
      ).mockResolvedValue();
      const prDefinition = await app.context.skills.get('pr', { cwd: workspace });
      if (!prDefinition) throw new Error('Expected the pr Skill in the production composition');
      const actionSkill = await snapshotSkillDefinition(prDefinition);
      const { closed, closure, receipt } = archiveState(actionSkill);
      const project = projectFixture({
        root: workspace,
        repositories: [
          {
            ...projectFixture().repositories[0]!,
            id: 'workspace',
            name: 'workspace',
            path: workspace,
            remoteIdentity: 'team/workspace',
          },
          {
            ...projectFixture().repositories[0]!,
            id: 'app',
            name: 'app',
            path: path.join(root, 'app'),
            remoteIdentity: 'team/app',
          },
        ],
      });
      const runtime = new WorkflowRunCoordinator(
        app.context.runStore,
        { export: () => Promise.resolve() },
        app.context.compositionIdentity.current(),
      );
      await runtime.start({
        workflow: workflowFixture(),
        projectSnapshot: project,
        runId: closed.identity.runId,
        changeLifecycle: closed,
      });
      await runtime.bindSkill(closed.identity.runId, actionSkill);

      const business = receipt.items.find((item) => item.role === 'business')!;
      const specification = receipt.items.find((item) => item.role === 'specification')!;
      vi.spyOn(app.context.delivery, 'validateArchiveIntent').mockResolvedValue();
      vi.spyOn(app.context.delivery, 'publishArchive').mockResolvedValue({
        snapshot: { digest: receipt.deliverySnapshotDigest } as never,
        receipts: [
          {
            actionId: 'push-primary',
            deliveryId: 'primary',
            type: 'git.push',
            status: 'succeeded',
            recovered: false,
            remoteOid: business.publishedOid,
          },
          {
            actionId: 'mr-primary',
            deliveryId: 'primary',
            type: 'mr.create_or_update',
            status: 'succeeded',
            recovered: false,
            mergeRequest: business.mergeRequest,
            provenance: business.provenance,
          },
        ],
      });
      const publishSpecification = vi
        .spyOn(app.context.delivery, 'publishSpecification')
        .mockRejectedValueOnce(
          new PublicationResultUnknownError(
            `specification:${closed.identity.runId}`,
            'merge-request',
            'specification merge request response unavailable',
          ),
        )
        .mockResolvedValue({
          expectedPublishedOid: specification.publishedOid,
          item: specification,
        });
      const prepareClosure = vi.spyOn(app.context.specification, 'prepareClosure');
      const close = vi.spyOn(app.context.specification, 'close');
      vi.spyOn(app.context.specification, 'phaseContext').mockResolvedValue(
        archivePhaseContext(closure.provider),
      );
      const executor = {
        actorId: 'archive-user',
        runnerId: 'archive-runner',
        source: 'runner' as const,
        authenticated: true,
      };

      const publicationClaim = await app.context.managedWorkExecutor.claimExternal({
        runId: closed.identity.runId,
        adapter: 'git',
        hostCapabilities: archiveHostCapabilities,
        executor,
      });
      await app.context.managedWorkExecutor.acceptExternalOutcome({
        schemaVersion: 3,
        runId: closed.identity.runId,
        submissionId: 'archive-publication-submission',
        invocationId: publicationClaim.invocation.invocationId,
        hostId: publicationClaim.invocation.host.id,
        packetDigest: publicationClaim.packet.identity.packetDigest,
        status: 'succeeded',
        summary: 'Archive publication packet consumed',
        consumedLayerDigests: publicationClaim.packet.context.layers
          .filter((layer) => ['action-skill', 'augmentation-skill'].includes(layer.kind))
          .map((layer) => layer.digest),
      });

      await expect(
        app.context.workflowRuns.executeArchiveDelivery({
          runId: closed.identity.runId,
          project,
          policy,
          executor,
          attempt: 1,
        }),
      ).rejects.toBeInstanceOf(PublicationResultUnknownError);
      await expect(app.context.runStore.loadRun(closed.identity.runId)).resolves.toMatchObject({
        status: 'running',
        workExecution: {
          status: 'unknown',
          continuation: 'reconcile',
          unknownKind: 'external-side-effect',
        },
        changeLifecycle: {
          currentWork: { kind: 'delivery.publish' },
          specificationClosure: { closureId: closed.specificationClosure?.closureId },
        },
      });

      const recovered = await app.context.workflowRuns.executeArchiveDelivery({
        runId: closed.identity.runId,
        project,
        policy,
        executor,
        attempt: 2,
      });
      expect(recovered.value.run.changeLifecycle).toMatchObject({
        status: 'completed',
        currentWork: null,
        publicationReceipt: { specificationClosure: receipt.specificationClosure },
      });
      expect(publishSpecification).toHaveBeenCalledTimes(2);
      expect(prepareClosure).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  }, 30_000);
});
