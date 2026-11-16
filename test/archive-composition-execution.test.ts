import { execFile } from 'node:child_process';
import { mkdir, rename, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { bootProjectComposition } from '../app/boot/bootstrap.js';
import {
  createPlanningSnapshot,
  recordSpecificationApprovalDecision,
  requestSpecificationApproval,
} from '../domains/specification/planning-approval.js';
import type { SpecificationChange } from '../domains/specification/types.js';
import type { DeliveryIntentV3, DeliveryPolicy } from '../domains/delivery/types.js';
import { FilePlanningApprovalStore } from '../platform/specification/file-planning-approval-store.js';
import { inspectRemoteChangeBranch } from '../platform/git/change-branch.js';
import { WorkflowRunCoordinator } from '../domains/runtime/workflow-runs.js';
import { createEvidenceBundle } from '../domains/evidence/gate.js';
import { FileEvidenceStore } from '../platform/evidence/file-evidence-store.js';
import { FilePublicationJournalStore } from '../platform/delivery/file-publication-journal-store.js';
import { GitSpecificationCheckoutManager } from '../platform/git/specification-checkout.js';
import { PublicationResultUnknownError } from '../domains/delivery/publication-result-unknown.js';
import { snapshotSkillDefinition } from '../platform/skill/snapshot.js';
import { evidenceInputDigest } from '../domains/evidence/input-snapshot.js';
import {
  createBuildProtocolState,
  createBuildStrategy,
  createBuildWorkspaceCheckpoint,
  createExecutionBinding,
  createExecutionWorkspaceIntent,
} from '../domains/change-lifecycle/build-protocol.js';
import {
  BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
  createChangeLifecycleSnapshot,
} from '../domains/change-lifecycle/definition.js';
import { createVerifyWork } from '../domains/change-lifecycle/verify-work.js';
import {
  createArchiveDeliveryInput,
  createArchivePublicationCheckpoint,
  createSpecificationCloseWork,
  createDeliveryPublishWork,
} from '../domains/change-lifecycle/archive-input.js';
import { verificationInputFixture } from './helpers/evidence-inputs.js';
import { parseSpecificationTasks } from '../domains/specification/tasks.js';
import {
  createGitRepository,
  createOpenSpecStoreEnvironment,
  removeTemporaryDirectory,
  specificationSchemaFixture,
  temporaryDirectory,
  workflowFixture,
} from './helpers/fixtures.js';

const git = promisify(execFile);
const cleanup: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await Promise.all(cleanup.splice(0).map(removeTemporaryDirectory));
});
const digest = (value: string) => `sha256:${value.repeat(64)}` as const;
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
const workspaceCredential = {
  provider: 'environment',
  variable: 'ARCHIVE_WORKSPACE_TOKEN',
} as const;
const policyCredential = { provider: 'environment', variable: 'ARCHIVE_POLICY_TOKEN' } as const;

async function fixture(integrated = false) {
  const root = await temporaryDirectory('repoctopus-archive-execution-context-');
  cleanup.push(root);
  const fixtureHost = path.join(root, 'github-fixture');
  const remote = integrated
    ? path.join(fixtureHost, 'team', 'workspace.git')
    : path.join(root, 'remote.git');
  await mkdir(remote, { recursive: true });
  await git('git', ['init', '--bare'], { cwd: remote });
  const workspace = await createGitRepository(
    root,
    'workspace',
    integrated ? 'github-fixture/team/workspace.git' : remote,
  );
  let business: string | undefined;
  if (integrated) {
    const businessRemote = path.join(fixtureHost, 'team', 'business.git');
    await mkdir(businessRemote);
    await git('git', ['init', '--bare'], { cwd: businessRemote });
    business = await createGitRepository(root, 'business', 'github-fixture/team/business.git');
    for (const checkout of [workspace, business]) {
      await symlink(
        fixtureHost,
        path.join(checkout, 'github-fixture'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    }
    await writeFile(path.join(business, '.git', 'info', 'exclude'), '/github-fixture\n');
    await git('git', ['push', '-u', 'origin', 'main'], { cwd: business });
    await git('git', ['switch', '-c', 'feature/archive-context'], { cwd: business });
    await writeFile(path.join(business, 'README.md'), '# Delivered business change\n');
    await git('git', ['add', 'README.md'], { cwd: business });
    await git('git', ['commit', '-m', 'feat: business contract fixture'], { cwd: business });
    const environment = await createOpenSpecStoreEnvironment(root, workspace, 'archive-execution');
    for (const key of [
      'XDG_DATA_HOME',
      'XDG_CONFIG_HOME',
      'OPENSPEC_NO_UPDATE_CHECK',
      'OPENSPEC_TELEMETRY',
    ]) {
      vi.stubEnv(key, environment[key]);
    }
    const active = path.join(workspace, 'openspec/changes/archive-context');
    await mkdir(path.join(active, 'specs/archive-context'), { recursive: true });
    await writeFile(path.join(active, 'proposal.md'), '# Why\n\nRecover Archive publication.\n');
    await writeFile(path.join(active, 'design.md'), '# Design\n\nPreserve execution authority.\n');
    await writeFile(
      path.join(active, 'tasks.md'),
      '- [x] 1.1 Publish.\n  **Acceptance:** It works\n',
    );
    await writeFile(
      path.join(active, 'specs/archive-context/spec.md'),
      '## ADDED Requirements\n\n### Requirement: Recovery\nThe Runtime SHALL recover Archive.\n\n#### Scenario: Resume\n- **WHEN** resumed\n- **THEN** publication continues\n',
    );
  }
  await git('git', ['push', '-u', 'origin', 'main'], { cwd: workspace });
  await git('git', ['switch', '-c', 'spec/archive-context'], { cwd: workspace });
  await writeFile(path.join(workspace, '.gitignore'), '.repoctopus/\n/github-fixture\n');
  await writeFile(
    path.join(workspace, 'repoctopus.yaml'),
    JSON.stringify({
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'RepoctopusWorkspace',
      workspace: { id: 'archive-execution', repositoryId: 'workspace' },
      repositories: [
        { id: 'workspace', path: '.' },
        ...(integrated ? [{ id: 'business', path: '../business' }] : []),
      ],
      ...(integrated
        ? {
            delivery: {
              checkpoint: policy.checkpoint,
              publication: { ...policy.publication, apiCredential: workspaceCredential },
            },
          }
        : {}),
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
  await git(
    'git',
    [
      'add',
      '.gitignore',
      'repoctopus.yaml',
      ...(integrated ? ['openspec', '.openspec-store'] : []),
    ],
    { cwd: workspace },
  );
  await git('git', ['commit', '-m', 'chore: configure archive execution fixture'], {
    cwd: workspace,
  });
  await git('git', ['push', '-u', 'origin', 'spec/archive-context'], { cwd: workspace });
  const branch = await inspectRemoteChangeBranch({
    repositoryPath: workspace,
    repositoryId: 'workspace',
    remote: 'origin',
    sourceBranch: 'spec/archive-context',
    targetBranch: 'main',
  });
  const change: SpecificationChange = {
    apiVersion: 'repoctopus.specification/v1alpha1',
    kind: 'SpecificationChange',
    changeId: 'archive-context',
    title: 'Archive execution contract fixture',
    provider: {
      id: 'openspec',
      version: '1.14.3',
      protocolVersion: 'repoctopus.specification/v1alpha1',
    },
    changeDigest: digest('a'),
    planningComplete: true,
    artifacts: [
      { id: 'proposal', kind: 'proposal', status: 'ready', digest: digest('1') },
      { id: 'design', kind: 'design', status: 'ready', digest: digest('2') },
      { id: 'specs', kind: 'delta-specs', status: 'ready', digest: digest('3') },
      { id: 'tasks', kind: 'tasks', status: 'ready', digest: digest('4') },
    ],
    affectedCapabilities: ['delivery-governance'],
    retiredCapabilities: [],
  };
  // Contract fixture with real approval constructors and Store. The real old
  // package-to-new-package Run is verified separately, without seeded facts.
  const snapshot = createPlanningSnapshot({
    change,
    schema: specificationSchemaFixture(change.provider),
    specificationRoot: {
      schemaVersion: 1,
      kind: 'SpecificationRoot',
      storeId: 'archive-execution',
      repositoryId: 'workspace',
    },
    validation: {
      apiVersion: 'repoctopus.specification/v1alpha1',
      kind: 'SpecificationValidation',
      changeId: change.changeId,
      provider: change.provider,
      strict: true,
      valid: true,
      validationDigest: digest('b'),
      diagnostics: [],
    },
    changeBranch: branch,
    buildStrategyDigest: digest('c'),
  });
  const waiting = requestSpecificationApproval({
    current: null,
    snapshot,
    timestamp: '2026-11-08T00:00:00.000Z',
  });
  const approved = recordSpecificationApprovalDecision({
    state: waiting,
    response: {
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'HumanDecisionResponse',
      requestId: waiting.decisionRequest.requestId,
      proposalHash: waiting.decisionRequest.proposalHash,
      decision: 'approve',
    },
    actor: { actorId: 'fixture-reviewer', source: 'cli', authenticated: true },
    timestamp: '2026-11-08T00:01:00.000Z',
  });
  const store = new FilePlanningApprovalStore(workspace);
  await store.commit(waiting, null);
  await store.commit(approved, waiting.stateVersion);
  const app = await bootProjectComposition(path.resolve(import.meta.dirname, '..'), workspace);
  const intent: DeliveryIntentV3 = {
    schemaVersion: 3,
    changeId: change.changeId,
    changeBranch: branch,
    businessDeliveries: integrated
      ? [
          {
            deliveryId: 'business',
            repositoryId: 'business',
            sourceBranch: 'feature/archive-context',
            targetBranch: 'main',
            commitMessage: 'feat: business contract fixture',
            actions: ['push', 'merge_request'],
          },
        ]
      : [],
  };
  return { app, intent, store, approved, workspace, business, root };
}

describe('Archive current execution composition', () => {
  async function resumePublicationOnApi(githubApiBaseUrl: string) {
    const custom = githubApiBaseUrl !== policy.publication.githubApiBaseUrl;
    vi.stubEnv('GITHUB_TOKEN', 'default-fixture-token');
    vi.stubEnv(workspaceCredential.variable, 'workspace-fixture-token');
    vi.stubEnv(policyCredential.variable, 'policy-fixture-token');
    const approvedPolicy = {
      ...policy,
      publication: {
        ...policy.publication,
        githubApiBaseUrl,
        ...(custom ? { apiCredential: policyCredential } : {}),
      },
    };
    const {
      app: initialApp,
      intent,
      store,
      approved,
      workspace,
      business,
      root,
    } = await fixture(true);
    let app = initialApp;
    const runId = 'run-archive-context';
    try {
      const current = app.context.compositionIdentity.current();
      // Explicit synthetic A/B contract fixture. These are metadata identities,
      // not a claim to execute the old package. The installed-package lab proves
      // the real predecessor separately. No Run/approval/Journal file is edited.
      const oldPlugins = current.plugins.map((plugin) => {
        if (!['delivery-file', 'workflow-runs'].includes(plugin.id)) return plugin;
        const predecessor = plugin.compatibleImplementations![0]!;
        return { ...plugin, ...predecessor };
      });
      const before = {
        ...current,
        plugins: oldPlugins,
        compositionDigest: evidenceInputDigest(oldPlugins),
      };
      const projectInput = {
        workspaceId: 'archive-execution',
        workspaceRoot: workspace,
        workspaceRepositoryId: 'workspace',
        repositories: [
          { id: 'workspace', path: workspace },
          { id: 'business', path: business! },
        ],
      };
      const project = await app.context.project.snapshot(projectInput);
      const workspaceIntent = createExecutionWorkspaceIntent({
        workspaceId: project.projectId,
        changeId: intent.changeId,
        isolation: 'current',
      });
      const checkouts = project.repositories.map((repository) => ({
        repositoryId: repository.id,
        checkoutPath: repository.path,
      }));
      const observed = await app.context.executionWorkspace.bind({
        intent: workspaceIntent,
        project,
        checkouts,
      });
      const strategy = createBuildStrategy({
        runId,
        revision: 1,
        executionMode: 'autonomous',
        tddMode: 'tdd',
        reviewMode: 'standard',
        isolationIntent: 'current',
      });
      const binding = createExecutionBinding({
        strategy,
        revision: 1,
        coordinatorHostId: 'external:cli:contract',
        workspaceBinding: observed,
        workspaceOwnerId: project.projectId,
        localOverlayRef: `execution-workspace:${observed.localDigest.slice(-24)}`,
      });
      const verification = verificationInputFixture(runId, 0, {
        compositionDigest: before.compositionDigest,
      });
      const definition = BUILTIN_CHANGE_LIFECYCLE_DEFINITION;
      const getSkill = async (name: string) => {
        const skill = await app.context.skills.get(name, { cwd: workspace });
        if (!skill) throw new Error(`Missing fixture Skill: ${name}`);
        return snapshotSkillDefinition(skill);
      };
      const actionSkill = await getSkill('pr');
      const verifyWork = createVerifyWork({
        definition,
        checkEpoch: 0,
        verification,
        actionSkill: await getSkill('repoctopus-verify-change'),
        augmentationSkills: [await getSkill('code-review')],
        workspaceRepositoryId: 'workspace',
        repositoryIds: ['workspace', 'business'],
      });
      const runtime = new WorkflowRunCoordinator(
        app.context.runStore,
        { async export() {} },
        before,
      );
      await runtime.start({
        workflow: workflowFixture(),
        projectSnapshot: project,
        runId,
        trigger: {
          schemaVersion: 1,
          kind: 'contract-fixture',
          identityDigest: evidenceInputDigest(checkouts),
          facts: { executionCheckouts: checkouts },
        },
        changeLifecycle: {
          ...createChangeLifecycleSnapshot({
            identity: { workspaceId: project.projectId, changeId: intent.changeId, runId },
          }),
          status: 'running',
          phase: 'verify',
          currentWork: verifyWork,
          verificationInput: verification,
          tasks: parseSpecificationTasks(
            'recovery',
            '- [x] 1.1 Build.\n  **Acceptance:** It works\n',
          ).tasks,
          workspaceIntent,
          planningDigest: approved.snapshot.digest,
          buildProtocol: {
            ...createBuildProtocolState({
              runId,
              planningDigest: approved.snapshot.digest,
              strategy,
            }),
            binding,
            bindingHistory: [binding],
            workspaceCheckpoint: createBuildWorkspaceCheckpoint(binding),
            currentAction: null,
          },
        },
      });
      const bundle = createEvidenceBundle({
        compositionDigest: before.compositionDigest,
        attemptId: 'attempt-original',
        profileId: 'verify',
        inputFingerprint: verification.evidenceProfile.fingerprintDigest,
        createdAt: '2026-11-08T00:00:00.000Z',
        checks: [],
        receiptIds: [],
        artifactDigests: [],
        findings: [],
      });
      await new FileEvidenceStore(workspace).saveBundle(bundle);
      await runtime.acceptChangeObservation(runId, {
        kind: 'verify-gate-satisfied',
        workId: verifyWork.workId,
        inputDigest: verification.digest,
        checkEpoch: 0,
        attemptId: bundle.attemptId,
        bundleId: bundle.bundleId,
        evidenceInputFingerprint: verification.evidenceProfile.fingerprintDigest,
      });
      const archive = createArchiveDeliveryInput({
        runId,
        changeId: intent.changeId,
        verificationInputDigest: verification.digest,
        acceptedEvidenceBundleIds: [bundle.bundleId],
        evidenceBundleId: bundle.bundleId,
        verificationReport: {
          apiVersion: 'repoctopus/v1alpha1',
          kind: 'ArtifactRef',
          artifactType: 'verification-report',
          mediaType: 'application/json',
          redacted: true,
          sha256: '4'.repeat(64),
          size: 64,
        },
        intent,
        policy: approvedPolicy,
        planningCompositionDigest: before.compositionDigest,
        evidenceCompositionDigest: before.compositionDigest,
        publicationCheckpoint: createArchivePublicationCheckpoint(project, intent),
      });
      const closeWork = createSpecificationCloseWork({
        definition,
        checkEpoch: 2,
        archive,
        actionSkill: await getSkill('repoctopus-archive-change'),
        workspaceRepositoryId: 'workspace',
        repositoryIds: ['workspace', 'business'],
      });
      await runtime.acceptChangeObservation(runId, {
        kind: 'archive-preflight-ready',
        archiveInput: archive,
        work: closeWork,
      });
      const candidate = await new GitSpecificationCheckoutManager(workspace).create(
        'closure-contract',
        intent.changeBranch.remoteOid,
      );
      // Git uses a local directory with a GitHub-shaped identity for the real MR adapter.
      await symlink(
        path.join(root, 'github-fixture'),
        path.join(candidate.root, 'github-fixture'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const active = 'openspec/changes/archive-context/proposal.md';
      const archived = 'openspec/changes/archive/2026-11-08-archive-context/proposal.md';
      await mkdir(path.dirname(path.join(candidate.root, archived)), { recursive: true });
      await rename(path.join(candidate.root, active), path.join(candidate.root, archived));
      const closure = {
        apiVersion: 'repoctopus.specification/v1alpha1' as const,
        kind: 'SpecificationClosureResult' as const,
        changeId: intent.changeId,
        provider: {
          id: 'openspec',
          version: '1.14.3',
          protocolVersion: 'repoctopus.specification/v1alpha1',
        },
        planDigest: digest('7'),
        closureId: digest('8'),
        status: 'closed' as const,
        archiveId: '2026-11-08-archive-context',
        changedFiles: [active, archived],
        candidate: { checkoutId: candidate.checkoutId, baseOid: candidate.head },
      };
      const publishWork = createDeliveryPublishWork({
        definition,
        checkEpoch: 3,
        archive,
        closure,
        actionSkill,
        workspaceRepositoryId: 'workspace',
        repositoryIds: ['workspace', 'business'],
      });
      await runtime.acceptChangeObservation(runId, {
        kind: 'archive-specification-closed',
        closure: {
          ...closure,
          provider: { ...closure.provider, protocolVersion: 'repoctopus.specification/v1alpha1' },
        },
        work: publishWork,
      });
      await runtime.bindSkill(runId, actionSkill);
      const frozen = await app.context.runStore.loadRun(runId);

      // Stub HTTP at the transport boundary so the adapter still chooses its API base.
      const requests = new Map<
        number,
        {
          number: number;
          html_url: string;
          title: string;
          body: string;
          state: 'open';
          merged_at: null;
          merge_commit_sha: null;
          head: { ref: string; sha: string };
          base: { ref: string };
        }
      >();
      let loseResponse = true;
      let observable = false;
      const fetchUrl = (input: Parameters<typeof fetch>[0]) =>
        new URL(input instanceof Request ? input.url : input);
      const fetchFixture = vi.fn<typeof fetch>(async (input, init) => {
        const url = fetchUrl(input);
        const [owner, repositoryId, route, number, detail] = url.pathname
          .slice(url.pathname.indexOf('/repos/') + '/repos/'.length)
          .split('/');
        expect(owner).toBe('team');
        if (route === 'commits') return Response.json({ state: 'success' });
        if (detail === 'reviews') return Response.json([{ state: 'APPROVED' }]);
        if (number) return Response.json(requests.get(Number(number)));
        const existing = (observable ? [...requests.values()] : []).filter((entry) =>
          new URL(entry.html_url).pathname.startsWith(`/team/${repositoryId}/`),
        );
        if (init?.method !== 'POST') {
          return Response.json(
            existing.filter(
              (entry) =>
                url.searchParams.get('head') === `team:${entry.head.ref}` &&
                url.searchParams.get('base') === entry.base.ref,
            ),
          );
        }
        if (typeof init.body !== 'string') throw new Error('Expected a JSON PR creation request');
        const payload = JSON.parse(init.body) as {
          head: string;
          base: string;
          title: string;
          body: string;
        };
        const repository = project.repositories.find((entry) => entry.id === repositoryId)!;
        const result = await git(
          'git',
          ['ls-remote', '--heads', 'origin', `refs/heads/${payload.head}`],
          { cwd: repository.path },
        );
        const pullNumber = requests.size + 1;
        const pull = {
          number: pullNumber,
          html_url: `https://github.com/team/${repositoryId}/pull/${pullNumber}`,
          title: payload.title,
          body: payload.body,
          state: 'open' as const,
          merged_at: null,
          merge_commit_sha: null,
          head: { ref: payload.head, sha: result.stdout.trim().split(/\s/u)[0]! },
          base: { ref: payload.base },
        };
        requests.set(pullNumber, pull);
        if (loseResponse) {
          loseResponse = false;
          throw new Error('External MR response lost after application');
        }
        return Response.json(pull, { status: 201 });
      });
      vi.stubGlobal('fetch', fetchFixture);
      const remoteRefs = () =>
        Promise.all(
          [workspace, business!].map(
            async (cwd) => (await git('git', ['ls-remote', '--heads', 'origin'], { cwd })).stdout,
          ),
        );
      const created = () => fetchFixture.mock.calls.filter(([, init]) => init?.method === 'POST');
      const executor = {
        actorId: 'contract-operator',
        runnerId: 'contract-runner',
        source: 'runner' as const,
        authenticated: true,
      };
      await app.context.workflowRuns.resume({ runId });
      const claim = await app.context.managedWorkExecutor.claimExternal({
        runId,
        adapter: 'manual',
        hostCapabilities: [
          'git.publish',
          'platform.mutate',
          'repository.read',
          'specification.write',
        ],
        executor,
      });
      await app.context.managedWorkExecutor.acceptExternalOutcome({
        schemaVersion: 3,
        runId,
        submissionId: 'publish-context',
        invocationId: claim.invocation.invocationId,
        hostId: claim.invocation.host.id,
        packetDigest: claim.packet.identity.packetDigest,
        status: 'succeeded',
        summary: 'Consumed the publication packet',
        consumedLayerDigests: claim.packet.context.layers
          .filter((layer) => ['action-skill', 'augmentation-skill'].includes(layer.kind))
          .map((layer) => layer.digest),
      });
      const adopted = await app.context.runStore.loadRun(runId);
      expect(adopted.composition.compositionDigest).toBe(current.compositionDigest);
      expect(adopted.changeLifecycle).toEqual(frozen.changeLifecycle);
      const beforeDrift = await remoteRefs();
      await expect(
        app.context.workflowRuns.executeArchiveDelivery({
          runId,
          project,
          policy: {
            ...approvedPolicy,
            publication: {
              ...approvedPolicy.publication,
              githubApiBaseUrl: 'https://other.example.test/api/v3',
            },
          },
          executor,
          attempt: 1,
        }),
      ).rejects.toThrow('Archive Delivery policy changed after Work planning');
      expect(await remoteRefs()).toEqual(beforeDrift);
      expect(fetchFixture).not.toHaveBeenCalled();
      await expect(
        app.context.workflowRuns.executeArchiveDelivery({
          runId,
          project,
          policy: approvedPolicy,
          executor,
          attempt: 1,
        }),
      ).rejects.toBeInstanceOf(PublicationResultUnknownError);
      const journal = await new FilePublicationJournalStore(workspace).load(runId);
      expect(journal?.items[0]?.status).toBe('mr-unknown');
      const interrupted = await app.context.runStore.loadRun(runId);
      expect(interrupted.workExecution?.continuation).toBe('reconcile');
      const originalInvocation = interrupted.workExecution?.hostInvocation;
      await app.close();
      observable = true;
      app = await bootProjectComposition(path.resolve(import.meta.dirname, '..'), workspace);
      expect((await app.context.runStore.loadRun(runId)).workExecution?.hostInvocation).toEqual(
        originalInvocation,
      );
      const recovered = await app.context.workflowRuns.executeArchiveDelivery({
        runId,
        project,
        policy: approvedPolicy,
        executor,
        attempt: 2,
      });
      expect(recovered.value.run.state.status).toBe('completed');
      expect(recovered.value.receipt?.items).toHaveLength(2);
      const completed = await app.context.runStore.loadRun(runId);
      expect(completed.changeLifecycle?.verificationInput).toEqual(verification);
      expect(completed.changeLifecycle?.archiveDeliveryInput).toEqual(archive);
      expect(completed.acceptedEvidenceBundleIds).toEqual([bundle.bundleId]);
      expect(completed.workExecution).toBeUndefined(); // completion retires the active Work
      expect(await store.load(intent.changeId)).toEqual(approved);
      const settledJournal = await new FilePublicationJournalStore(workspace).load(runId);
      expect(settledJournal?.items[0]?.operationId).toBe(journal?.items[0]?.operationId);
      expect(settledJournal?.items[0]?.status).toBe('published');
      const expectedPaths = ['business', 'workspace'].map(
        (repositoryId) => `${githubApiBaseUrl}/repos/team/${repositoryId}/pulls`,
      );
      const expectedAuthorization = custom
        ? 'Bearer policy-fixture-token'
        : 'Bearer default-fixture-token';
      const authorizations = fetchFixture.mock.calls.map(([, init]) =>
        new Headers(init?.headers).get('Authorization'),
      );
      expect([...new Set(authorizations)]).toEqual([expectedAuthorization]);
      expect(created().map(([input]) => fetchUrl(input).href)).toEqual(expectedPaths);
      const requestUrls = fetchFixture.mock.calls.map(([input]) => fetchUrl(input).href);
      for (const endpoint of expectedPaths) {
        expect(requestUrls.some((url) => url.startsWith(`${endpoint}?state=all&`))).toBe(true);
      }
      expect(
        requestUrls.filter((url) => !url.startsWith(`${githubApiBaseUrl}/repos/team/`)),
      ).toEqual([]);
      const terminal = await app.context.workflowRuns.resume({ runId });
      expect(terminal.value.state).toEqual(completed);
      expect(await new FilePublicationJournalStore(workspace).load(runId)).toEqual(settledJournal);
      expect(created()).toHaveLength(2);
    } finally {
      await app.close();
    }
  }

  it.each(['https://ghe.example.test/api/v3', 'https://api.github.com'])(
    'adopts A into B and resumes publication on the approved API %s after a lost MR response',
    resumePublicationOnApi,
    60_000,
  );

  it('accepts the actual execution context without changing the original Planning approval', async () => {
    const { app, intent, store, approved } = await fixture();
    try {
      const execution = {
        runId: 'run-archive-context',
        changeId: intent.changeId,
        compositionDigest: app.context.compositionIdentity.current().compositionDigest,
      };
      await expect(
        app.context.delivery.validateArchiveIntent(intent, policy, execution),
      ).resolves.toBeUndefined();
      expect(await store.load(intent.changeId)).toEqual(approved);
    } finally {
      await app.close();
    }
  });

  it.each(['composition', 'change'] as const)(
    'rejects a mismatched execution %s while preserving the approval',
    async (mismatch) => {
      const { app, intent, store, approved } = await fixture();
      try {
        const execution = {
          runId: 'run-archive-context',
          changeId: mismatch === 'change' ? 'another-change' : intent.changeId,
          compositionDigest:
            mismatch === 'composition'
              ? digest('d')
              : app.context.compositionIdentity.current().compositionDigest,
        };
        await expect(
          app.context.delivery.validateArchiveIntent(intent, policy, execution),
        ).rejects.toThrow(/execution|composition|approval/u);
        expect(await store.load(intent.changeId)).toEqual(approved);
      } finally {
        await app.close();
      }
    },
  );
});
