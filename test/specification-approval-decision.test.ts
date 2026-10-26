import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { reviewSpecificationApproval } from '../app/cli/specification-approval-decision.js';
import type { SpecificationApprovalDecisionRequest } from '../domains/specification/types.js';
import { specificationSchemaFixture } from './helpers/fixtures.js';

const request: SpecificationApprovalDecisionRequest = {
  apiVersion: 'repoctopus/v1alpha1',
  kind: 'HumanDecisionRequest',
  decisionType: 'specification-approval',
  requestId: 'request',
  changeId: 'change-approval',
  approvalPhase: 'design',
  snapshotDigest: `sha256:${'a'.repeat(64)}`,
  proposal: {
    schemaVersion: 1,
    kind: 'SpecificationApprovalProposal',
    changeId: 'change-approval',
    approvalPhase: 'design',
    specificationRoot: {
      schemaVersion: 1,
      kind: 'SpecificationRoot',
      storeId: 'team-platform',
      repositoryId: 'workspace',
    },
    provider: {
      id: 'openspec',
      version: '1.14.3',
      protocolVersion: 'repoctopus.specification/v1alpha1',
    },
    schema: { name: 'spec-driven', digest: `sha256:${'b'.repeat(64)}` },
    semanticDigest: `sha256:${'a'.repeat(64)}`,
    affectedCapabilities: ['delivery-governance'],
    targetBranch: 'main',
  },
  proposalHash: `sha256:${'c'.repeat(64)}`,
  provider: {
    id: 'openspec',
    version: '1.14.3',
    protocolVersion: 'repoctopus.specification/v1alpha1',
  },
  schema: specificationSchemaFixture(),
  artifacts: [
    { id: 'proposal', kind: 'proposal', digest: `sha256:${'1'.repeat(64)}` },
    { id: 'design', kind: 'design', digest: `sha256:${'2'.repeat(64)}` },
    { id: 'specs', kind: 'delta-specs', digest: `sha256:${'3'.repeat(64)}` },
    { id: 'tasks', kind: 'tasks', digest: `sha256:${'4'.repeat(64)}` },
  ],
  affectedCapabilities: ['delivery-governance'],
  changeBranch: {
    repositoryId: 'workspace',
    remoteIdentity: 'github.com/team/workspace',
    sourceBranch: 'spec/change-approval',
    targetBranch: 'main',
    remoteOid: '1'.repeat(40),
  },
  options: ['approve', 'revise', 'reject'],
};

describe('interactive specification approval', () => {
  it.each([
    ['1', 'approved', 'approve'],
    ['2', 'revise scope', 'revise'],
    ['3', 'reject scope', 'reject'],
  ] as const)('maps TTY choice %s to %s', async (choice, comment, decision) => {
    const input = new PassThrough();
    const output = new PassThrough();
    const reviewed = reviewSpecificationApproval({ request, input, output });
    input.write(`${choice}\n`);
    setTimeout(() => input.write(`${comment}\n`), 5);
    await expect(reviewed).resolves.toMatchObject({ decision, comment });
    input.end();
  });

  it('rejects an unknown choice instead of defaulting to approval', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const reviewed = reviewSpecificationApproval({ request, input, output });
    input.end('yes\n');
    await expect(reviewed).rejects.toThrow(/must be 1, 2, or 3/iu);
  });
});
