import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertPlanningSnapshot,
  createPlanningSnapshot,
  createSpecificationApprovalRequest,
} from '../domains/specification/planning-approval.js';
import type {
  ChangeBranchReference,
  SpecificationChange,
  SpecificationValidation,
} from '../domains/specification/types.js';

const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

const branch: ChangeBranchReference = {
  repositoryId: 'workspace',
  remoteIdentity: 'github.com/team/workspace',
  sourceBranch: 'spec/change-approval',
  targetBranch: 'main',
  remoteOid: '1'.repeat(40),
};

const change: SpecificationChange = {
  apiVersion: 'repoctopus.specification/v1alpha1',
  kind: 'SpecificationChange',
  changeId: 'change-approval',
  title: 'Change approval',
  provider: {
    id: 'openspec',
    version: '1.14.3',
    protocolVersion: 'repoctopus.specification/v1alpha1',
  },
  changeDigest: digest('a'),
  planningComplete: true,
  artifacts: [
    { id: 'tasks', kind: 'tasks', status: 'ready', digest: digest('4') },
    { id: 'proposal', kind: 'proposal', status: 'ready', digest: digest('1') },
    { id: 'specs', kind: 'delta-specs', status: 'ready', digest: digest('3') },
    { id: 'design', kind: 'design', status: 'ready', digest: digest('2') },
  ],
  affectedCapabilities: ['post-merge-automation', 'delivery-governance'],
};

const validation: SpecificationValidation = {
  apiVersion: 'repoctopus.specification/v1alpha1',
  kind: 'SpecificationValidation',
  changeId: change.changeId,
  provider: change.provider,
  strict: true,
  valid: true,
  validationDigest: digest('b'),
  diagnostics: [],
};

function planningInput() {
  return {
    change: structuredClone(change),
    validation: structuredClone(validation),
    changeBranch: structuredClone(branch),
    compositionDigest: digest('c'),
    projectConfigDigest: digest('d'),
  };
}

describe('specification planning approval', () => {
  it('creates a stable snapshot from the four planning artifacts and published branch', () => {
    const first = createPlanningSnapshot(planningInput());
    const reordered = planningInput();
    reordered.change.artifacts.reverse();
    reordered.change.affectedCapabilities.reverse();
    const second = createPlanningSnapshot(reordered);

    expect(second).toEqual(first);
    expect(first.artifacts.map((artifact) => artifact.kind)).toEqual([
      'design',
      'proposal',
      'delta-specs',
      'tasks',
    ]);
    expect(first.affectedCapabilities).toEqual(['delivery-governance', 'post-merge-automation']);
    expect(first.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(() => assertPlanningSnapshot(first)).not.toThrow();
  });

  it.each([
    [
      'change',
      (input: ReturnType<typeof planningInput>): void => {
        input.change.changeDigest = digest('e');
      },
    ],
    [
      'proposal',
      (input: ReturnType<typeof planningInput>) => {
        input.change.artifacts.find((artifact) => artifact.kind === 'proposal')!.digest =
          digest('e');
      },
    ],
    [
      'design',
      (input: ReturnType<typeof planningInput>) => {
        input.change.artifacts.find((artifact) => artifact.kind === 'design')!.digest = digest('e');
      },
    ],
    [
      'delta specs',
      (input: ReturnType<typeof planningInput>) => {
        input.change.artifacts.find((artifact) => artifact.kind === 'delta-specs')!.digest =
          digest('e');
      },
    ],
    [
      'tasks',
      (input: ReturnType<typeof planningInput>) => {
        input.change.artifacts.find((artifact) => artifact.kind === 'tasks')!.digest = digest('e');
      },
    ],
    [
      'provider',
      (input: ReturnType<typeof planningInput>) => {
        input.change.provider.version = '1.15.0';
        input.validation.provider.version = '1.15.0';
      },
    ],
    [
      'target branch',
      (input: ReturnType<typeof planningInput>): void => {
        input.changeBranch.targetBranch = 'release';
      },
    ],
    [
      'remote oid',
      (input: ReturnType<typeof planningInput>): void => {
        input.changeBranch.remoteOid = '2'.repeat(40);
      },
    ],
  ] as const)('changes the snapshot identity when %s drifts', (_label, mutate) => {
    const baseline = createPlanningSnapshot(planningInput());
    const changed = planningInput();
    mutate(changed);
    expect(createPlanningSnapshot(changed).digest).not.toBe(baseline.digest);
  });

  it('rejects incomplete, unvalidated, or unpublished planning facts', () => {
    const missing = planningInput();
    missing.change.artifacts = missing.change.artifacts.filter(
      (artifact) => artifact.kind !== 'tasks',
    );
    expect(() => createPlanningSnapshot(missing)).toThrow(/exactly four/u);

    const invalid = planningInput();
    invalid.validation.valid = false;
    expect(() => createPlanningSnapshot(invalid)).toThrow(/strict validation/u);

    const localOnly = planningInput();
    localOnly.changeBranch.remoteOid = '';
    expect(() => createPlanningSnapshot(localOnly)).toThrow(/remoteOid is required/u);
  });

  it('creates the versioned human decision request and rejects snapshot tampering', async () => {
    const snapshot = createPlanningSnapshot(planningInput());
    const request = createSpecificationApprovalRequest(snapshot, 'approval-request');
    expect(request).toMatchObject({
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'HumanDecisionRequest',
      decisionType: 'specification-approval',
      requestId: 'approval-request',
      snapshotDigest: snapshot.digest,
      changeBranch: branch,
      options: ['approve', 'request_changes', 'reject'],
    });

    const schema = JSON.parse(
      await readFile(
        path.resolve(
          import.meta.dirname,
          '..',
          'docs',
          'schemas',
          'specification-approval-decision.schema.json',
        ),
        'utf8',
      ),
    ) as { oneOf: Array<{ properties: { decisionType?: { const: string } } }> };
    expect(schema.oneOf[0]?.properties.decisionType?.const).toBe('specification-approval');

    const tampered = { ...snapshot, projectConfigDigest: digest('e') };
    expect(() => createSpecificationApprovalRequest(tampered)).toThrow(/digest is invalid/u);
  });
});
