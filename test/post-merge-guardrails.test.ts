import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  auditPostMergeClosure,
  type PostMergeWorkspaceChange,
} from '../domains/post-merge/closure.js';
import type {
  SpecificationClosurePlan,
  SpecificationClosureResult,
} from '../domains/specification/types.js';
import { canonicalJson } from '../domains/workflow-contract/canonical.js';

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

const provider = {
  id: 'openspec',
  version: '1.14.3',
  protocolVersion: 'repoctopus.specification/v1alpha1' as const,
};
const baselineBase = {
  schemaVersion: 1 as const,
  root: 'C:/workspace',
  head: '1'.repeat(40),
  tree: '2'.repeat(40),
};
const baseline = { ...baselineBase, digest: digest(baselineBase) };
const planBase = {
  apiVersion: 'repoctopus.specification/v1alpha1',
  kind: 'SpecificationClosurePlan',
  changeId: 'finish-self-hosting',
  provider,
  changeDigest: `sha256:${'c'.repeat(64)}` as const,
  mergeFactsDigest: `sha256:${'a'.repeat(64)}` as const,
  targetBaselineDigest: baseline.digest,
  affectedCapabilities: ['post-merge-automation'],
  allowedPathPrefixes: [
    'openspec/changes/archive/',
    'openspec/changes/finish-self-hosting/',
    'openspec/specs/post-merge-automation/',
  ],
} satisfies Omit<SpecificationClosurePlan, 'planDigest'>;
const plan: SpecificationClosurePlan = { ...planBase, planDigest: digest(planBase) };
const archiveId = '2026-10-21-finish-self-hosting';
const result: SpecificationClosureResult = {
  apiVersion: 'repoctopus.specification/v1alpha1',
  kind: 'SpecificationClosureResult',
  changeId: plan.changeId,
  provider,
  planDigest: plan.planDigest,
  closureId: digest({ planDigest: plan.planDigest, archiveId }),
  status: 'closed',
  archiveId,
  changedFiles: [
    'openspec/changes/archive/2026-10-21-finish-self-hosting/proposal.md',
    'openspec/changes/finish-self-hosting/proposal.md',
    'openspec/specs/post-merge-automation/spec.md',
  ],
};

function change(
  path: string,
  status: PostMergeWorkspaceChange['status'] = 'modified',
  contentType: PostMergeWorkspaceChange['contentType'] = 'text',
): PostMergeWorkspaceChange {
  return { path, status, contentType, contentDigest: digest({ path, status, contentType }) };
}

function audit(
  changes: PostMergeWorkspaceChange[],
  overrides: {
    plan?: SpecificationClosurePlan;
    result?: SpecificationClosureResult;
    verificationPathPrefixes?: string[];
  } = {},
) {
  return auditPostMergeClosure({
    plan: overrides.plan ?? plan,
    result: overrides.result ?? result,
    verificationPathPrefixes: overrides.verificationPathPrefixes ?? ['verification/post-merge/'],
    diff: {
      baseline,
      head: '1'.repeat(40),
      tree: '2'.repeat(40),
      changes,
    },
  });
}

const closureChanges = [
  change(result.changedFiles[0]!, 'added'),
  change(result.changedFiles[1]!, 'deleted'),
  change(result.changedFiles[2]!),
];

describe('post-merge closure Guardrail', () => {
  it('accepts only the bound main specification, exact change archive, and verification records', () => {
    const guarded = audit([...closureChanges, change('verification/post-merge/run.json', 'added')]);
    expect(guarded.changedFiles).toEqual([
      'openspec/changes/archive/2026-10-21-finish-self-hosting/proposal.md',
      'openspec/changes/finish-self-hosting/proposal.md',
      'openspec/specs/post-merge-automation/spec.md',
      'verification/post-merge/run.json',
    ]);
  });

  it.each([
    ['business source', change('services/runtime.ts')],
    ['unknown file', change('notes.txt', 'added')],
    ['binary record', change('verification/post-merge/run.json', 'added', 'binary')],
    ['symbolic link', change('verification/post-merge/run.json', 'added', 'symlink')],
  ])('fails closed for %s', (_label, unexpected) => {
    expect(() => audit([...closureChanges, unexpected])).toThrow();
  });

  it('rejects broad glob configuration before examining the diff', () => {
    expect(() => audit(closureChanges, { verificationPathPrefixes: ['**/'] })).toThrow(
      'concrete project-relative path',
    );
    const broadBase = { ...planBase, allowedPathPrefixes: ['openspec/**'] };
    expect(() =>
      audit(closureChanges, {
        plan: { ...broadBase, planDigest: digest(broadBase) },
      }),
    ).toThrow('concrete project-relative path');
    expect(() =>
      audit([...closureChanges, change('services/verification/result.json', 'added')], {
        verificationPathPrefixes: ['services/verification/'],
      }),
    ).toThrow('must identify a verification directory');
  });

  it('fails closed when the actual diff and Provider closure result disagree', () => {
    expect(() => audit(closureChanges.slice(1))).toThrow('does not match the closure result');
    expect(() =>
      audit(closureChanges, {
        result: { ...result, changedFiles: [...result.changedFiles, 'services/runtime.ts'] },
      }),
    ).toThrow('changed an unplanned path');
  });
});
