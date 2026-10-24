import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertPlanningSnapshot,
  assertSpecificationApprovalState,
  createPlanningSnapshot,
  createSpecificationApprovalRequest,
  recordSpecificationApprovalDecision,
  requestSpecificationApproval,
} from '../domains/specification/planning-approval.js';
import { canonicalJson } from '../domains/workflow-contract/canonical.js';
import type {
  ChangeBranchReference,
  SpecificationApprovalState,
  SpecificationChange,
  SpecificationValidation,
} from '../domains/specification/types.js';
import { specificationSchemaFixture } from './helpers/fixtures.js';

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
  retiredCapabilities: [],
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
    schema: specificationSchemaFixture(change.provider),
    specificationRoot: {
      schemaVersion: 1 as const,
      kind: 'SpecificationRoot' as const,
      storeId: 'team-platform',
      repositoryId: 'workspace',
    },
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
        input.schema = specificationSchemaFixture(input.change.provider);
      },
    ],
    [
      'target branch',
      (input: ReturnType<typeof planningInput>): void => {
        input.changeBranch.targetBranch = 'release';
      },
    ],
  ] as const)('changes the snapshot identity when %s drifts', (_label, mutate) => {
    const baseline = createPlanningSnapshot(planningInput());
    const changed = planningInput();
    mutate(changed);
    expect(createPlanningSnapshot(changed).digest).not.toBe(baseline.digest);
  });

  it('tracks a new published OID without invalidating the approved Design', () => {
    const baseline = createPlanningSnapshot(planningInput());
    const waiting = requestSpecificationApproval({
      current: null,
      snapshot: baseline,
      requestId: 'published-baseline',
      timestamp: '2026-10-24T00:00:00.000Z',
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
      actor: { actorId: 'trusted-user', source: 'cli', authenticated: true },
      timestamp: '2026-10-24T00:01:00.000Z',
    });
    const pushed = planningInput();
    pushed.changeBranch.remoteOid = '2'.repeat(40);
    const republished = createPlanningSnapshot(pushed);
    expect(republished.digest).toBe(baseline.digest);
    expect(republished.publicationProvenanceDigest).not.toBe(baseline.publicationProvenanceDigest);

    const refreshed = requestSpecificationApproval({
      current: approved,
      snapshot: republished,
      timestamp: '2026-10-24T00:02:00.000Z',
    });
    expect(refreshed).toMatchObject({
      status: 'approved',
      stateVersion: approved.stateVersion + 1,
      decision: { approvalHash: approved.decision?.approvalHash },
      snapshot: { changeBranch: { remoteOid: '2'.repeat(40) } },
      decisionRequest: { changeBranch: { remoteOid: '2'.repeat(40) } },
    });
    expect(refreshed.decisionRequest.proposalHash).toBe(approved.decisionRequest.proposalHash);
    expect(() => assertSpecificationApprovalState(refreshed)).not.toThrow();

    const planningChanged = planningInput();
    planningChanged.change.artifacts.find((artifact) => artifact.kind === 'design')!.digest =
      digest('e');
    const invalidated = requestSpecificationApproval({
      current: refreshed,
      snapshot: createPlanningSnapshot(planningChanged),
      requestId: 'changed-planning',
      timestamp: '2026-10-24T00:03:00.000Z',
    });
    expect(invalidated).toMatchObject({
      status: 'awaiting_approval',
      decision: null,
      decisionRequest: { requestId: 'changed-planning' },
    });
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
      schema: { digest: snapshot.schema!.digest },
      changeBranch: branch,
      options: ['approve', 'revise', 'reject'],
    });
    expect(request.proposalHash).toMatch(/^sha256:[a-f0-9]{64}$/u);

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

  it('binds proposal and approval hashes to every protected Design input', () => {
    const baseline = createPlanningSnapshot(planningInput());
    const waiting = requestSpecificationApproval({
      current: null,
      snapshot: baseline,
      requestId: 'baseline-request',
      timestamp: '2026-10-24T00:00:00.000Z',
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
      actor: { actorId: 'trusted-user', source: 'cli', authenticated: true },
      timestamp: '2026-10-24T00:01:00.000Z',
    });
    expect(approved.decision?.approvalHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(() => assertSpecificationApprovalState(approved)).not.toThrow();

    const tamperedApproval = structuredClone(approved);
    tamperedApproval.decision!.approvalHash = digest('f');
    expect(() => assertSpecificationApprovalState(tamperedApproval)).toThrow(
      /approval hash is invalid/u,
    );

    const tamperedStatus = structuredClone(approved);
    tamperedStatus.status = 'awaiting_approval';
    expect(() => assertSpecificationApprovalState(tamperedStatus)).toThrow(
      /status does not match/u,
    );

    const cases: Array<[string, (input: ReturnType<typeof planningInput>) => void]> = [
      [
        'change',
        (input) => {
          input.change.changeId = 'another-change';
          input.validation.changeId = 'another-change';
        },
      ],
      [
        'Store',
        (input) => {
          input.specificationRoot.storeId = 'another-store';
        },
      ],
      [
        'Provider',
        (input) => {
          input.change.provider.version = '1.15.0';
          input.validation.provider.version = '1.15.0';
          input.schema = specificationSchemaFixture(input.change.provider);
        },
      ],
      [
        'schema',
        (input) => {
          input.schema.artifacts[0]!.templateDigest = digest('f');
          const stable = Object.fromEntries(
            Object.entries(input.schema).filter(([key]) => key !== 'digest'),
          );
          input.schema.digest = `sha256:${createHash('sha256')
            .update(canonicalJson(stable))
            .digest('hex')}`;
        },
      ],
      [
        'semantic digest',
        (input) => {
          input.change.artifacts[0]!.digest = digest('f');
        },
      ],
      [
        'capabilities',
        (input) => {
          input.change.affectedCapabilities.push('another-capability');
        },
      ],
      [
        'target branch',
        (input) => {
          input.changeBranch.targetBranch = 'release';
        },
      ],
    ];
    for (const [label, mutate] of cases) {
      const changed = planningInput();
      mutate(changed);
      const snapshot = createPlanningSnapshot(changed);
      const pending = requestSpecificationApproval({
        current: null,
        snapshot,
        requestId: `changed-${label}`,
        timestamp: '2026-10-24T00:02:00.000Z',
      });
      expect(() =>
        recordSpecificationApprovalDecision({
          state: pending,
          response: {
            apiVersion: 'repoctopus/v1alpha1',
            kind: 'HumanDecisionResponse',
            requestId: pending.decisionRequest.requestId,
            proposalHash: waiting.decisionRequest.proposalHash,
            decision: 'approve',
          },
          actor: { actorId: 'trusted-user', source: 'cli', authenticated: true },
          timestamp: '2026-10-24T00:03:00.000Z',
        }),
      ).toThrow(/does not match the pending request/u);
    }
  });

  it.each([
    ['revise', 'changes_requested'],
    ['reject', 'rejected'],
  ] as const)('records %s without minting an approval hash', (decision, status) => {
    const waiting = requestSpecificationApproval({
      current: null,
      snapshot: createPlanningSnapshot(planningInput()),
      requestId: `request-${decision}`,
      timestamp: '2026-10-24T00:00:00.000Z',
    });
    const decided = recordSpecificationApprovalDecision({
      state: waiting,
      response: {
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'HumanDecisionResponse',
        requestId: waiting.decisionRequest.requestId,
        proposalHash: waiting.decisionRequest.proposalHash,
        decision,
      },
      actor: { actorId: 'trusted-user', source: 'cli', authenticated: true },
      timestamp: '2026-10-24T00:01:00.000Z',
    });
    expect(decided).toMatchObject({ status, decision: { decision, approvalHash: null } });
    expect(() => assertSpecificationApprovalState(decided)).not.toThrow();
  });

  it('replaces a readable legacy approval with a new pending decision', () => {
    const currentSnapshot = createPlanningSnapshot(planningInput());
    const current = requestSpecificationApproval({
      current: null,
      snapshot: currentSnapshot,
      requestId: 'current-request',
      timestamp: '2026-10-24T00:00:00.000Z',
    });
    const legacy = structuredClone(current) as unknown as Record<string, unknown>;
    const legacySnapshot = legacy.snapshot as Record<string, unknown>;
    delete legacySnapshot.schema;
    delete legacySnapshot.specificationRoot;
    delete legacySnapshot.planningManifestDigest;
    delete legacySnapshot.publicationProvenanceDigest;
    const { digest: _digest, ...legacyStable } = legacySnapshot;
    void _digest;
    legacySnapshot.digest = `sha256:${createHash('sha256')
      .update(canonicalJson(legacyStable))
      .digest('hex')}`;
    const legacyRequest = legacy.decisionRequest as Record<string, unknown>;
    delete legacyRequest.proposal;
    delete legacyRequest.proposalHash;
    delete legacyRequest.schema;
    legacyRequest.snapshotDigest = legacySnapshot.digest;

    const migrated = requestSpecificationApproval({
      current: legacy as unknown as SpecificationApprovalState,
      snapshot: currentSnapshot,
      requestId: 'migration-decision',
      timestamp: '2026-10-24T00:01:00.000Z',
    });
    expect(migrated).toMatchObject({
      status: 'awaiting_approval',
      stateVersion: current.stateVersion + 1,
      decision: null,
      decisionRequest: {
        requestId: 'migration-decision',
        proposal: { semanticDigest: currentSnapshot.digest },
      },
    });
    expect(migrated.decisionRequest.proposalHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    const approved = recordSpecificationApprovalDecision({
      state: migrated,
      response: {
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'HumanDecisionResponse',
        requestId: migrated.decisionRequest.requestId,
        proposalHash: migrated.decisionRequest.proposalHash,
        decision: 'approve',
      },
      actor: { actorId: 'migration-reviewer', source: 'cli', authenticated: true },
      timestamp: '2026-10-24T00:02:00.000Z',
    });
    expect(approved.status).toBe('approved');
  });
});
