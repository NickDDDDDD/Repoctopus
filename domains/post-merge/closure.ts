import { createHash } from 'node:crypto';

import {
  SPECIFICATION_API_VERSION,
  type SpecificationClosurePlan,
  type SpecificationClosureResult,
} from '../specification/types.js';
import { canonicalJson } from '../workflow-contract/canonical.js';

export type PostMergeWorkspaceChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';
export type PostMergeWorkspaceContentType = 'text' | 'binary' | 'symlink' | 'unsupported';

export interface PostMergeWorkspaceBaseline {
  schemaVersion: 1;
  root: string;
  head: string;
  tree: string;
  digest: `sha256:${string}`;
}

export interface PostMergeWorkspaceChange {
  path: string;
  status: PostMergeWorkspaceChangeStatus;
  contentType: PostMergeWorkspaceContentType;
  contentDigest: `sha256:${string}`;
  previousPath?: string;
  previousContentDigest?: `sha256:${string}`;
}

export interface PostMergeWorkspaceDiff {
  baseline: PostMergeWorkspaceBaseline;
  head: string;
  tree: string;
  changes: PostMergeWorkspaceChange[];
}

export interface PostMergeWorkspacePort {
  cleanBaseline(root: string): Promise<PostMergeWorkspaceBaseline>;
  diff(baseline: PostMergeWorkspaceBaseline): Promise<PostMergeWorkspaceDiff>;
}

export interface PostMergeClosureAudit {
  schemaVersion: 1;
  planDigest: `sha256:${string}`;
  closureId: `sha256:${string}`;
  baselineDigest: `sha256:${string}`;
  changedFiles: string[];
  contentDigests: Record<string, `sha256:${string}`>;
  digest: `sha256:${string}`;
}

const SAFE_TEXT_EXTENSIONS = new Set(['.json', '.md', '.yaml', '.yml']);
const BUSINESS_ROOTS = new Set([
  'app',
  'bin',
  'deploy',
  'domains',
  'lib',
  'platform',
  'plugins',
  'scripts',
  'services',
  'src',
  'test',
  'third_party',
  'workflows',
]);
const GLOB_META = /[*?[\]{}!]/u;

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0)!;
    return code <= 0x1f || code === 0x7f;
  });
}

function normalizeRelativePath(value: string, label: string, directory: boolean): string {
  const normalized = value.replaceAll('\\', '/');
  const segments = normalized.split('/').filter(Boolean);
  const result = segments.join('/');
  const canonical = directory ? `${result}/` : result;
  if (
    value !== normalized ||
    normalized !== canonical ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:/u.test(normalized) ||
    containsControlCharacter(normalized) ||
    segments.length === 0 ||
    segments.some((segment) => segment === '.' || segment === '..') ||
    GLOB_META.test(normalized)
  ) {
    throw new Error(`${label} must be a concrete project-relative path: ${value}`);
  }
  return canonical;
}

function prefix(path: string, root: string): boolean {
  return path.startsWith(root);
}

function expectedPlanPrefixes(plan: SpecificationClosurePlan): string[] {
  const changeId = normalizeRelativePath(plan.changeId, 'Specification change id', false);
  if (changeId.includes('/')) {
    throw new Error(`Specification change id must be one path segment: ${plan.changeId}`);
  }
  const capabilityPrefixes = plan.affectedCapabilities.map((capability) => {
    const normalized = normalizeRelativePath(capability, 'Affected capability', false);
    if (normalized.includes('/')) {
      throw new Error(`Affected capability must be one path segment: ${capability}`);
    }
    return `openspec/specs/${normalized}/`;
  });
  return [
    ...capabilityPrefixes,
    `openspec/changes/${changeId}/`,
    'openspec/changes/archive/',
  ].sort();
}

export function assertSafeClosurePlan(plan: SpecificationClosurePlan): void {
  if (plan.apiVersion !== SPECIFICATION_API_VERSION || plan.kind !== 'SpecificationClosurePlan') {
    throw new Error('Specification closure plan contract is invalid');
  }
  const { planDigest, ...unsigned } = plan;
  if (sha256(unsigned) !== planDigest) {
    throw new Error('Specification closure plan digest is invalid');
  }
  const actual = plan.allowedPathPrefixes
    .map((item) => normalizeRelativePath(item, 'Closure plan path prefix', true))
    .sort();
  const expected = expectedPlanPrefixes(plan);
  if (new Set(actual).size !== actual.length || canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error('Specification closure plan contains paths outside its semantic scope');
  }
}

function safeVerificationPrefixes(values: readonly string[]): string[] {
  const result = values.map((item) =>
    normalizeRelativePath(item, 'Verification path prefix', true),
  );
  if (result.some((item) => item.startsWith('openspec/'))) {
    throw new Error('Verification paths cannot overlap Specification authority paths');
  }
  if (
    result.some((item) => {
      const segments = item.split('/').filter(Boolean);
      return BUSINESS_ROOTS.has(segments[0]!) || !segments.includes('verification');
    })
  ) {
    throw new Error('Verification path prefixes must identify a verification directory');
  }
  if (new Set(result).size !== result.length) {
    throw new Error('Verification path prefixes must be unique');
  }
  return result.sort();
}

function assertText(change: PostMergeWorkspaceChange): void {
  if (change.contentType !== 'text') {
    throw new Error(`Post-merge change is not a regular text file: ${change.path}`);
  }
  const extension = change.path.toLowerCase().slice(change.path.lastIndexOf('.'));
  if (!SAFE_TEXT_EXTENSIONS.has(extension)) {
    throw new Error(`Post-merge change has an unsupported content type: ${change.path}`);
  }
}

function semanticClosurePaths(
  plan: SpecificationClosurePlan,
  result: SpecificationClosureResult,
): Set<string> {
  assertSafeClosurePlan(plan);
  if (
    result.apiVersion !== SPECIFICATION_API_VERSION ||
    result.kind !== 'SpecificationClosureResult' ||
    result.changeId !== plan.changeId ||
    result.planDigest !== plan.planDigest ||
    result.provider.id !== plan.provider.id ||
    result.provider.version !== plan.provider.version ||
    result.provider.protocolVersion !== plan.provider.protocolVersion ||
    result.status !== 'closed'
  ) {
    throw new Error('Specification closure result does not match its bound plan');
  }
  const active = `openspec/changes/${plan.changeId}/`;
  const archive = `openspec/changes/archive/${normalizeRelativePath(
    result.archiveId,
    'Specification archive id',
    false,
  )}/`;
  if (
    result.archiveId.includes('/') ||
    sha256({ planDigest: plan.planDigest, archiveId: result.archiveId }) !== result.closureId
  ) {
    throw new Error('Specification closure identity is invalid');
  }
  const capabilities = plan.affectedCapabilities.map(
    (capability) => `openspec/specs/${capability}/`,
  );
  const allowedByPlan = plan.allowedPathPrefixes.map((item) =>
    normalizeRelativePath(item, 'Closure plan path prefix', true),
  );
  const changed = result.changedFiles.map((item) =>
    normalizeRelativePath(item, 'Specification changed file', false),
  );
  if (new Set(changed).size !== changed.length || changed.length === 0) {
    throw new Error('Specification closure result must contain unique changed files');
  }
  for (const file of changed) {
    const semantic =
      prefix(file, active) ||
      prefix(file, archive) ||
      capabilities.some((root) => prefix(file, root));
    if (!semantic || !allowedByPlan.some((root) => prefix(file, root))) {
      throw new Error(`Specification closure changed an unplanned path: ${file}`);
    }
  }
  return new Set(changed);
}

export function auditPostMergeClosure(input: {
  plan: SpecificationClosurePlan;
  result: SpecificationClosureResult;
  diff: PostMergeWorkspaceDiff;
  verificationPathPrefixes?: readonly string[];
}): PostMergeClosureAudit {
  const planned = semanticClosurePaths(input.plan, input.result);
  const verification = safeVerificationPrefixes(input.verificationPathPrefixes ?? []);
  if (
    input.diff.head !== input.diff.baseline.head ||
    input.diff.tree !== input.diff.baseline.tree ||
    input.diff.baseline.digest !== input.plan.targetBaselineDigest
  ) {
    throw new Error('Post-merge workspace baseline drifted before path audit');
  }
  const { digest: baselineDigest, ...unsignedBaseline } = input.diff.baseline;
  if (sha256(unsignedBaseline) !== baselineDigest) {
    throw new Error('Post-merge workspace baseline digest is invalid');
  }
  const actual = new Set<string>();
  const contentDigests: Record<string, `sha256:${string}`> = {};
  for (const change of input.diff.changes) {
    const file = normalizeRelativePath(change.path, 'Post-merge changed file', false);
    if (actual.has(file)) throw new Error(`Post-merge diff contains a duplicate path: ${file}`);
    actual.add(file);
    contentDigests[file] = change.contentDigest;
    if (change.previousPath) {
      const previous = normalizeRelativePath(
        change.previousPath,
        'Post-merge renamed source',
        false,
      );
      if (actual.has(previous)) {
        throw new Error(`Post-merge diff contains a duplicate path: ${previous}`);
      }
      if (!planned.has(previous)) {
        throw new Error(`Post-merge rename originates outside the closure plan: ${previous}`);
      }
      actual.add(previous);
      if (!change.previousContentDigest) {
        throw new Error(`Post-merge rename has no source content identity: ${previous}`);
      }
      contentDigests[previous] = change.previousContentDigest;
    }
    if (!planned.has(file) && !verification.some((root) => prefix(file, root))) {
      throw new Error(`Post-merge diff contains an unapproved path: ${file}`);
    }
    assertText(change);
  }
  const missing = [...planned].filter((file) => !actual.has(file));
  if (missing.length > 0) {
    throw new Error(`Post-merge diff does not match the closure result: ${missing.join(', ')}`);
  }
  const base = {
    schemaVersion: 1 as const,
    planDigest: input.plan.planDigest,
    closureId: input.result.closureId,
    baselineDigest: input.diff.baseline.digest,
    changedFiles: [...actual].sort(),
    contentDigests: Object.fromEntries(
      [...actual].sort().map((file) => [file, contentDigests[file]!] as const),
    ),
  };
  return { ...base, digest: sha256(base) };
}

export function assertPostMergeClosureAudit(
  audit: PostMergeClosureAudit,
  input: {
    plan: SpecificationClosurePlan;
    result: SpecificationClosureResult;
    baseline: PostMergeWorkspaceBaseline;
  },
): void {
  const { digest, ...unsigned } = audit;
  if (
    audit.schemaVersion !== 1 ||
    audit.planDigest !== input.plan.planDigest ||
    audit.closureId !== input.result.closureId ||
    audit.baselineDigest !== input.baseline.digest ||
    sha256(unsigned) !== digest
  ) {
    throw new Error('Post-merge closure audit identity is invalid');
  }
}
