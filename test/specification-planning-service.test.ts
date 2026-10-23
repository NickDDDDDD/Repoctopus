import { Context } from '@deepseek-ai/cordis';
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
import { Specification } from '../services/specification.js';
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

  identity(): SpecificationProviderIdentity {
    return this.provider;
  }

  override planningInstructions(): Promise<SpecificationSchemaInstructions> {
    return Promise.resolve(specificationSchemaFixture(this.provider));
  }

  inspect(changeId: string): Promise<SpecificationChange> {
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
    compositionDigest: digest('c'),
    projectConfigDigest: digest('d'),
    requestId: 'request-1',
    now: () => new Date('2026-10-22T00:00:00.000Z'),
  } as const;
}

describe('SpecificationPlanning service', () => {
  it('persists, recovers, and idempotently reuses a pending planning approval', async () => {
    const workspace = await temporaryDirectory('repoctopus-spec-planning-');
    cleanup.push(workspace);
    const first = app(workspace);
    const prepared = await first.planning.prepare(prepareInput());
    expect(prepared).toMatchObject({
      stateVersion: 0,
      status: 'awaiting_approval',
      decisionRequest: { requestId: 'request-1' },
    });
    expect(
      await first.planning.prepare({ ...prepareInput(), requestId: 'request-ignored' }),
    ).toEqual(prepared);
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
      snapshotDigest: prepared.snapshot.digest,
      decision: 'approve' as const,
    };
    await expect(
      running.planning.decide({
        changeId: prepared.changeId,
        response,
        actor: { actorId: 'user', source: 'cli', authenticated: false },
      }),
    ).rejects.toThrow(/not trusted/u);

    const approved = await running.planning.decide({
      changeId: prepared.changeId,
      response,
      actor: { actorId: 'user', source: 'cli', authenticated: true },
      now: () => new Date('2026-10-22T00:01:00.000Z'),
    });
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
});
