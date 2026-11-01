import { Context } from '@deepseek-ai/cordis';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  SpecificationChange,
  SpecificationClosurePlan,
  SpecificationClosureResult,
  SpecificationProviderIdentity,
  SpecificationSchemaInstructions,
  SpecificationValidation,
} from '../domains/specification/types.js';
import { SpecificationPlanning } from '../services/specification-planning.js';
import { Specification, type SpecificationRoot } from '../services/specification.js';
import {
  removeTemporaryDirectory,
  specificationSchemaFixture,
  temporaryDirectory,
} from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

class TestSpecification extends Specification {
  readonly provider: SpecificationProviderIdentity = {
    id: 'test-specification',
    version: '1.0.0',
    protocolVersion: 'repoctopus.specification/v1alpha1',
  };
  proposalDigest = digest('1');
  unavailable = false;

  identity(): SpecificationProviderIdentity {
    return this.provider;
  }

  override planningInstructions(): Promise<SpecificationSchemaInstructions> {
    return Promise.resolve(specificationSchemaFixture(this.provider));
  }

  override root(): SpecificationRoot {
    return {
      schemaVersion: 1,
      kind: 'SpecificationRoot',
      storeId: 'planning-service',
      repositoryId: 'workspace',
    };
  }

  override verifyRoot(): Promise<SpecificationRoot> {
    return Promise.resolve(this.root());
  }

  inspect(changeId: string): Promise<SpecificationChange> {
    if (this.unavailable) return Promise.reject(new Error('provider unavailable'));
    return Promise.resolve({
      apiVersion: 'repoctopus.specification/v1alpha1',
      kind: 'SpecificationChange',
      changeId,
      title: changeId,
      provider: this.provider,
      changeDigest: digest('a'),
      planningComplete: true,
      artifacts: [
        { id: 'proposal', kind: 'proposal', status: 'ready', digest: this.proposalDigest },
        { id: 'design', kind: 'design', status: 'ready', digest: digest('2') },
        { id: 'specs', kind: 'delta-specs', status: 'ready', digest: digest('3') },
        { id: 'tasks', kind: 'tasks', status: 'ready', digest: digest('4') },
      ],
      affectedCapabilities: ['delivery-governance'],
      retiredCapabilities: [],
    });
  }

  validate(changeId: string): Promise<SpecificationValidation> {
    return Promise.resolve({
      apiVersion: 'repoctopus.specification/v1alpha1',
      kind: 'SpecificationValidation',
      changeId,
      provider: this.provider,
      strict: true,
      valid: true,
      validationDigest: digest('b'),
      diagnostics: [],
    });
  }

  prepareClosure(): Promise<SpecificationClosurePlan> {
    return Promise.reject(new Error('not used'));
  }

  close(): Promise<SpecificationClosureResult> {
    return Promise.reject(new Error('not used'));
  }
}

function app(workspace: string) {
  const context = new Context();
  const specification = new TestSpecification(context);
  const planning = new SpecificationPlanning(context, { workspaceRoot: workspace });
  return { context, specification, planning };
}

function prepareInput() {
  return {
    changeId: 'planning-approval',
    changeBranch: {
      repositoryId: 'workspace',
      remoteIdentity: 'github.com/team/workspace',
      sourceBranch: 'spec/planning-approval',
      targetBranch: 'main',
      remoteOid: '1'.repeat(40),
    },
    requestId: 'request-1',
    now: () => new Date('2026-10-22T00:00:00.000Z'),
  } as const;
}

describe('SpecificationPlanning service', () => {
  it('rejects a pre-release approval without rewriting or dual-reading the Store', async () => {
    const workspace = await temporaryDirectory('repoctopus-spec-planning-migration-');
    cleanup.push(workspace);
    const running = app(workspace);
    await running.planning.prepare(prepareInput());
    const stateFile = path.join(
      workspace,
      '.repoctopus',
      'specification-approvals',
      'planning-approval',
      'design',
      'state.json',
    );
    const legacy = JSON.parse(await readFile(stateFile, 'utf8')) as {
      snapshot: { schemaVersion: number };
    };
    legacy.snapshot.schemaVersion = 1;
    const bytes = `${JSON.stringify(legacy, null, 2)}\n`;
    await writeFile(stateFile, bytes);

    await expect(running.planning.status('planning-approval')).rejects.toThrow(
      /legacy planning snapshot requires migration/iu,
    );
    expect(await readFile(stateFile, 'utf8')).toBe(bytes);
    await running.context.fiber.dispose();
  });

  it('revalidates an approved Open snapshot without refreshing approval state', async () => {
    const workspace = await temporaryDirectory('repoctopus-open-revalidation-');
    cleanup.push(workspace);
    const running = app(workspace);
    const input = { ...prepareInput(), approvalPhase: 'open' as const };
    const prepared = await running.planning.prepare(input);
    const approved = await running.planning.decide({
      changeId: prepared.changeId,
      approvalPhase: 'open',
      response: {
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'HumanDecisionResponse',
        requestId: prepared.decisionRequest.requestId,
        proposalHash: prepared.decisionRequest.proposalHash,
        decision: 'approve',
      },
      actor: { actorId: 'user', source: 'cli', authenticated: true },
    });

    await expect(
      running.planning.revalidateOpenApproval({
        ...input,
        expectedSnapshotDigest: approved.snapshot.digest,
      }),
    ).resolves.toMatchObject({ status: 'accepted' });

    running.specification.proposalDigest = digest('9');
    await expect(
      running.planning.revalidateOpenApproval({
        ...input,
        expectedSnapshotDigest: approved.snapshot.digest,
      }),
    ).resolves.toMatchObject({
      status: 'invalid',
      source: 'approval-drift',
      reasonCode: 'approval-drift',
    });
    expect(await running.planning.status(prepared.changeId, 'open')).toEqual(approved);

    running.specification.unavailable = true;
    await expect(
      running.planning.revalidateOpenApproval({
        ...input,
        expectedSnapshotDigest: approved.snapshot.digest,
      }),
    ).resolves.toMatchObject({ status: 'unavailable', evidenceDigests: [] });
    expect(await running.planning.status(prepared.changeId, 'open')).toEqual(approved);

    running.specification.unavailable = false;
    running.specification.proposalDigest = digest('1');
    const refreshed = await running.planning.assess({
      ...input,
      requestId: 'request-after-repair',
      forceNewApproval: true,
    });
    expect(refreshed).toMatchObject({
      status: 'waiting',
      approval: {
        status: 'awaiting_approval',
        decision: null,
        decisionRequest: { requestId: 'request-after-repair' },
      },
    });
    expect(
      await running.planning.assess({
        ...input,
        requestId: 'request-after-repair',
        forceNewApproval: true,
      }),
    ).toEqual(refreshed);
    await running.context.fiber.dispose();
  });

  it('persists, recovers, and idempotently reuses a pending planning approval', async () => {
    const workspace = await temporaryDirectory('repoctopus-spec-planning-');
    cleanup.push(workspace);
    const first = app(workspace);
    const [prepared, concurrent] = await Promise.all([
      first.planning.prepare(prepareInput()),
      first.planning.prepare(prepareInput()),
    ]);
    expect(concurrent).toEqual(prepared);
    expect(prepared).toMatchObject({
      stateVersion: 0,
      status: 'awaiting_approval',
      decisionRequest: { requestId: 'request-1' },
    });
    expect(
      await first.planning.prepare({ ...prepareInput(), requestId: 'request-ignored' }),
    ).toEqual(prepared);
    expect(await first.planning.migrationPlan('planning-approval')).toMatchObject({
      status: 'current',
      requiredActions: [],
      externalSideEffects: [],
    });
    await first.context.fiber.dispose();

    const recovered = app(workspace);
    expect(await recovered.planning.status('planning-approval')).toEqual(prepared);
    await recovered.context.fiber.dispose();
  });

  it('records only a matching trusted decision and invalidates it after artifact drift', async () => {
    const workspace = await temporaryDirectory('repoctopus-spec-planning-');
    cleanup.push(workspace);
    const running = app(workspace);
    const prepared = await running.planning.prepare(prepareInput());
    const response = {
      apiVersion: 'repoctopus/v1alpha1' as const,
      kind: 'HumanDecisionResponse' as const,
      requestId: prepared.decisionRequest.requestId,
      proposalHash: prepared.decisionRequest.proposalHash,
      decision: 'approve' as const,
    };
    await expect(
      running.planning.decide({
        changeId: prepared.changeId,
        response,
        actor: { actorId: 'user', source: 'cli', authenticated: false },
      }),
    ).rejects.toThrow(/not trusted/u);

    const [approved, concurrentApproval] = await Promise.all([
      running.planning.decide({
        changeId: prepared.changeId,
        response,
        actor: { actorId: 'user', source: 'cli', authenticated: true },
        now: () => new Date('2026-10-22T00:01:00.000Z'),
      }),
      running.planning.decide({
        changeId: prepared.changeId,
        response,
        actor: { actorId: 'user', source: 'cli', authenticated: true },
        now: () => new Date('2026-10-22T00:01:00.000Z'),
      }),
    ]);
    expect(concurrentApproval).toEqual(approved);
    expect(approved).toMatchObject({ status: 'approved', stateVersion: 1 });

    running.specification.proposalDigest = digest('9');
    const drifted = await running.planning.prepare({
      ...prepareInput(),
      requestId: 'request-2',
      now: () => new Date('2026-10-22T00:02:00.000Z'),
    });
    expect(drifted).toMatchObject({
      status: 'awaiting_approval',
      stateVersion: 2,
      decision: null,
      decisionRequest: { requestId: 'request-2' },
    });
    await running.context.fiber.dispose();
  });

  it('observes later-phase planning authority without refreshing the approval store', async () => {
    const workspace = await temporaryDirectory('repoctopus-spec-planning-observe-');
    cleanup.push(workspace);
    const running = app(workspace);
    const prepared = await running.planning.prepare(prepareInput());
    const approved = await running.planning.decide({
      changeId: prepared.changeId,
      response: {
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'HumanDecisionResponse',
        requestId: prepared.decisionRequest.requestId,
        proposalHash: prepared.decisionRequest.proposalHash,
        decision: 'approve',
      },
      actor: { actorId: 'user', source: 'cli', authenticated: true },
    });
    const expectedPlanningDigest = approved.snapshot.planningManifestDigest;

    await expect(
      running.planning.observeAuthority({
        ...prepareInput(),
        expectedPlanningDigest,
      }),
    ).resolves.toMatchObject({
      status: 'authorized',
      observationKind: 'same',
      invalidationKind: null,
      planningDigest: expectedPlanningDigest,
      reasonCode: 'authorized',
    });

    await expect(
      running.planning.observeAuthority({
        ...prepareInput(),
        changeBranch: {
          ...prepareInput().changeBranch,
          remoteIdentity: 'HTTPS://GitHub.com/team/workspace.git',
          sourceBranch: 'spec/republished-change',
          remoteOid: '2'.repeat(40),
        },
        expectedPlanningDigest,
      }),
    ).resolves.toMatchObject({
      status: 'authorized',
      observationKind: 'publication',
      invalidationKind: null,
      reasonCode: 'authorized',
    });

    running.specification.proposalDigest = digest('9');
    await expect(
      running.planning.observeAuthority({
        ...prepareInput(),
        expectedPlanningDigest,
      }),
    ).resolves.toMatchObject({
      status: 'invalid',
      observationKind: 'semantic',
      invalidationKind: 'semantic',
      reasonCode: 'semantic-drift',
    });
    expect(await running.planning.status(prepared.changeId)).toEqual(approved);

    running.specification.proposalDigest = digest('1');
    await expect(
      running.planning.observeAuthority({
        ...prepareInput(),
        changeBranch: { ...prepareInput().changeBranch, targetBranch: 'release' },
        expectedPlanningDigest,
      }),
    ).resolves.toMatchObject({
      status: 'invalid',
      observationKind: 'approval-authority',
      invalidationKind: 'approval-authority',
      reasonCode: 'approval-stale',
    });
    expect(await running.planning.status(prepared.changeId)).toEqual(approved);
    await running.context.fiber.dispose();
  });
});
