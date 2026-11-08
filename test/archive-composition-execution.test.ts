import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

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
import {
  createGitRepository,
  removeTemporaryDirectory,
  specificationSchemaFixture,
  temporaryDirectory,
} from './helpers/fixtures.js';

const git = promisify(execFile);
const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));
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

async function fixture() {
  const root = await temporaryDirectory('repoctopus-archive-execution-context-');
  cleanup.push(root);
  const remote = path.join(root, 'remote.git');
  await mkdir(remote);
  await git('git', ['init', '--bare'], { cwd: remote });
  const workspace = await createGitRepository(root, 'workspace', remote);
  await git('git', ['push', '-u', 'origin', 'main'], { cwd: workspace });
  await git('git', ['switch', '-c', 'spec/archive-context'], { cwd: workspace });
  await writeFile(path.join(workspace, '.gitignore'), '.repoctopus/\n');
  await writeFile(
    path.join(workspace, 'repoctopus.yaml'),
    JSON.stringify({
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'RepoctopusWorkspace',
      workspace: { id: 'archive-execution', repositoryId: 'workspace' },
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
  await git('git', ['add', '.gitignore', 'repoctopus.yaml'], { cwd: workspace });
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
    businessDeliveries: [],
  };
  return { app, intent, store, approved };
}

describe('Archive current execution composition', () => {
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
