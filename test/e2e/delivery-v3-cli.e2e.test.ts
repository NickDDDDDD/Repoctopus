import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createPlanningSnapshot,
  recordSpecificationApprovalDecision,
  requestSpecificationApproval,
} from '../../domains/specification/planning-approval.js';
import type {
  SpecificationChange,
  SpecificationValidation,
} from '../../domains/specification/types.js';
import { FilePlanningApprovalStore } from '../../platform/specification/file-planning-approval-store.js';
import { normalizeRemoteIdentity } from '../../platform/git/remote-identity.js';
import { loadProjectConfig } from '../../platform/project-configuration/file-config.js';
import { bootProjectComposition } from '../../app/boot/bootstrap.js';
import {
  createGitRepository,
  removeTemporaryDirectory,
  temporaryDirectory,
} from '../helpers/fixtures.js';
import { runCli } from './cli.js';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, '..', '..');
const cleanup: string[] = [];
const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

async function bareRemote(root: string, name: string): Promise<string> {
  const remote = path.join(root, name);
  await mkdir(remote);
  await execFileAsync('git', ['init', '--bare'], { cwd: remote });
  return remote;
}

async function approvePlanning(
  workspace: string,
  changeId: string,
  changeBranch: {
    repositoryId: string;
    remoteIdentity: string;
    sourceBranch: string;
    targetBranch: string;
    remoteOid: string;
  },
  compositionDigest: `sha256:${string}`,
  projectConfigDigest: `sha256:${string}`,
): Promise<void> {
  const provider = {
    id: 'openspec',
    version: '1.14.3',
    protocolVersion: 'repoctopus.specification/v1alpha1' as const,
  };
  const change: SpecificationChange = {
    apiVersion: 'repoctopus.specification/v1alpha1',
    kind: 'SpecificationChange',
    changeId,
    title: changeId,
    provider,
    changeDigest: digest('a'),
    planningComplete: true,
    artifacts: [
      { id: 'proposal', kind: 'proposal', status: 'ready', digest: digest('1') },
      { id: 'design', kind: 'design', status: 'ready', digest: digest('2') },
      { id: 'specs', kind: 'delta-specs', status: 'ready', digest: digest('3') },
      { id: 'tasks', kind: 'tasks', status: 'ready', digest: digest('4') },
    ],
    affectedCapabilities: ['delivery-governance'],
  };
  const validation: SpecificationValidation = {
    apiVersion: 'repoctopus.specification/v1alpha1',
    kind: 'SpecificationValidation',
    changeId,
    provider,
    strict: true,
    valid: true,
    validationDigest: digest('b'),
    diagnostics: [],
  };
  const snapshot = createPlanningSnapshot({
    change,
    validation,
    changeBranch,
    compositionDigest,
    projectConfigDigest,
  });
  const waiting = requestSpecificationApproval({
    current: null,
    snapshot,
    requestId: 'planning-request',
    timestamp: '2026-10-22T00:00:00.000Z',
  });
  const approved = recordSpecificationApprovalDecision({
    state: waiting,
    response: {
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'HumanDecisionResponse',
      requestId: waiting.decisionRequest.requestId,
      snapshotDigest: waiting.snapshot.digest,
      decision: 'approve',
    },
    actor: { actorId: 'trusted-user', source: 'cli', authenticated: true },
    timestamp: '2026-10-22T00:00:01.000Z',
  });
  await new FilePlanningApprovalStore(workspace).commit(approved, null);
}

describe('Delivery v3 CLI', () => {
  it('prepares a default Business MR without requiring or creating a Change MR', async () => {
    const root = await temporaryDirectory('repoctopus-delivery-v3-cli-');
    cleanup.push(root);
    const workspaceRemote = await bareRemote(root, 'workspace-remote.git');
    const appRemote = await bareRemote(root, 'app-remote.git');
    const workspace = await createGitRepository(root, 'workspace', workspaceRemote);
    const app = await createGitRepository(root, 'app', appRemote);
    await execFileAsync('git', ['push', '-u', 'origin', 'main'], { cwd: workspace });
    await execFileAsync('git', ['push', '-u', 'origin', 'main'], { cwd: app });
    await execFileAsync('git', ['switch', '-c', 'spec/delivery-v3-cli'], { cwd: workspace });
    await execFileAsync('git', ['switch', '-c', 'feat/delivery-v3-cli'], { cwd: app });

    await writeFile(
      path.join(workspace, 'repoctopus.yaml'),
      JSON.stringify({
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'RepoctopusWorkspace',
        workspace: { id: 'delivery-v3-cli', repositoryId: 'workspace' },
        repositories: [
          { id: 'workspace', path: '.' },
          { id: 'app', path: '../app' },
        ],
        profiles: [
          {
            id: 'verify',
            nodes: [
              {
                id: 'check',
                type: 'command',
                repository: 'app',
                executable: process.execPath,
                args: ['-e', 'process.exit(0)'],
              },
            ],
          },
        ],
        delivery: {
          checkpoint: {
            automatic: true,
            protectedBranches: ['main'],
            commitMessagePattern: '^feat: .+',
            quickChecks: {},
          },
          publication: {
            remote: 'origin',
            provider: 'github',
            githubApiBaseUrl: 'https://api.github.test',
            mrTitleTemplate: '{{changeId}}',
            mrBodyTemplate: '{{verificationReport}}',
          },
        },
      }),
    );
    await writeFile(path.join(workspace, '.gitignore'), '.repoctopus/\n');
    await execFileAsync('git', ['add', 'repoctopus.yaml', '.gitignore'], { cwd: workspace });
    await execFileAsync('git', ['commit', '-m', 'chore: configure delivery v3'], {
      cwd: workspace,
    });
    await execFileAsync('git', ['push', '-u', 'origin', 'spec/delivery-v3-cli'], {
      cwd: workspace,
    });
    await writeFile(path.join(app, 'verification.md'), '# Verification\nPassed\n');
    await writeFile(path.join(app, 'feature.txt'), 'feature\n');
    await execFileAsync('git', ['add', 'verification.md', 'feature.txt'], { cwd: app });
    await execFileAsync('git', ['commit', '-m', 'feat: implement delivery v3'], { cwd: app });
    await execFileAsync('git', ['push', '-u', 'origin', 'feat/delivery-v3-cli'], { cwd: app });

    const workspaceOid = (
      await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: workspace })
    ).stdout.trim();
    const changeBranch = {
      repositoryId: 'workspace',
      remoteIdentity: normalizeRemoteIdentity(workspaceRemote),
      sourceBranch: 'spec/delivery-v3-cli',
      targetBranch: 'main',
      remoteOid: workspaceOid,
    };
    const intentFile = path.join(root, 'delivery-v3.yaml');
    await writeFile(
      intentFile,
      `schemaVersion: 3\nchangeId: delivery-v3-cli\nchangeBranch:\n  repositoryId: workspace\n  remoteIdentity: ${changeBranch.remoteIdentity}\n  sourceBranch: spec/delivery-v3-cli\n  targetBranch: main\n  remoteOid: ${workspaceOid}\nbusinessDeliveries:\n  - deliveryId: primary\n    repositoryId: app\n    sourceBranch: feat/delivery-v3-cli\n    targetBranch: main\n    commitMessage: 'feat: implement delivery v3'\n    actions: [push, merge_request]\n`,
    );

    const evidence = await runCli<{ bundle: { bundleId: string } }>({
      packageRoot,
      cwd: workspace,
      args: ['evidence', 'run', '--workspace', workspace, '--profile', 'verify'],
    });
    const prepareArgs = [
      'delivery',
      'prepare',
      '--workspace',
      workspace,
      '--intent',
      intentFile,
      '--policy',
      path.join(workspace, 'repoctopus.yaml'),
      '--report',
      path.join(app, 'verification.md'),
      '--evidence-bundles',
      evidence.result!.bundle.bundleId,
    ];
    let unapprovedFailure: { code?: number; stderr?: string } | undefined;
    try {
      await execFileAsync(
        process.execPath,
        [path.join(packageRoot, 'bin', 'repoctopus.js'), ...prepareArgs, '--json'],
        { cwd: workspace },
      );
    } catch (error) {
      unapprovedFailure = error as { code?: number; stderr?: string };
    }
    expect(unapprovedFailure?.code).toBe(1);
    expect(unapprovedFailure?.stderr).toMatch(/effective planning approval/i);

    const config = await loadProjectConfig(workspace);
    const composition = await bootProjectComposition(packageRoot, workspace);
    const compositionDigest = composition.composition.compositionDigest;
    await composition.close();
    await approvePlanning(
      workspace,
      'delivery-v3-cli',
      changeBranch,
      compositionDigest,
      `sha256:${config.effectiveDigest}`,
    );
    const prepared = await runCli<{
      schemaVersion: number;
      status: string;
      decisionRequest: Record<string, unknown>;
      businessMergeRequests: Array<{ mergeRequest: unknown }>;
      finalChangeMergeRequest: unknown;
    }>({
      packageRoot,
      cwd: workspace,
      args: prepareArgs,
    });
    expect(prepared).toMatchObject({
      ok: true,
      result: {
        schemaVersion: 3,
        status: 'awaiting_approval',
        businessMergeRequests: [{ mergeRequest: null }],
        finalChangeMergeRequest: null,
      },
    });
    expect(prepared.result?.decisionRequest).toHaveProperty('businessDeliveries');
    expect(prepared.result?.decisionRequest).not.toHaveProperty('changeMergeRequest');
    const status = await runCli({
      packageRoot,
      cwd: workspace,
      args: ['delivery', 'status', '--workspace', workspace, '--change', 'delivery-v3-cli'],
    });
    expect(status).toMatchObject({ result: { schemaVersion: 3, status: 'awaiting_approval' } });

    const concurrentWorkspace = path.join(root, 'workspace-concurrent');
    await execFileAsync('git', ['clone', workspaceRemote, concurrentWorkspace], { cwd: root });
    await execFileAsync('git', ['config', 'user.name', 'Repoctopus Test'], {
      cwd: concurrentWorkspace,
    });
    await execFileAsync('git', ['config', 'user.email', 'repoctopus@example.invalid'], {
      cwd: concurrentWorkspace,
    });
    await execFileAsync('git', ['switch', 'spec/delivery-v3-cli'], {
      cwd: concurrentWorkspace,
    });
    await writeFile(
      path.join(concurrentWorkspace, 'planning-drift.txt'),
      'changed after approval\n',
    );
    await execFileAsync('git', ['add', 'planning-drift.txt'], { cwd: concurrentWorkspace });
    await execFileAsync('git', ['commit', '-m', 'docs: change approved planning input'], {
      cwd: concurrentWorkspace,
    });
    await execFileAsync('git', ['push', 'origin', 'spec/delivery-v3-cli'], {
      cwd: concurrentWorkspace,
    });

    let driftFailure: { code?: number; stderr?: string } | undefined;
    try {
      await execFileAsync(
        process.execPath,
        [path.join(packageRoot, 'bin', 'repoctopus.js'), ...prepareArgs, '--json'],
        { cwd: workspace },
      );
    } catch (error) {
      driftFailure = error as { code?: number; stderr?: string };
    }
    expect(driftFailure?.code).toBe(1);
    expect(driftFailure?.stderr).toMatch(/effective planning approval/i);
  }, 30_000);
});
