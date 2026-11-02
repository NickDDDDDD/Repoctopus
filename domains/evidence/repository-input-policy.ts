import { createHash } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';

export type RepositoryInputPathMatch = 'file' | 'tree';
export type RepositoryInputTrackedDisposition = 'product' | 'conflict';
export type RepositoryInputFileKind = 'file';

export interface RepositoryInputPolicyRule {
  id: string;
  owner: string;
  path: string;
  match: RepositoryInputPathMatch;
  tracked: RepositoryInputTrackedDisposition;
  allowedKinds: readonly RepositoryInputFileKind[];
}

export interface RepositoryInputPolicyContributor {
  identity: { id: string; version: string };
  rules: readonly RepositoryInputPolicyRule[];
}

export interface CompiledRepositoryInputPolicy {
  schemaVersion: 1;
  contributors: readonly RepositoryInputPolicyContributor['identity'][];
  rules: readonly RepositoryInputPolicyRule[];
  digest: `sha256:${string}`;
}

export type RepositoryInputClassification =
  | { kind: 'product' }
  | { kind: 'control-plane'; ruleId: string; owner: string }
  | { kind: 'conflict'; ruleId: string; owner: string };

const IDENTIFIER = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:\//u;
const MAX_RULES = 128;

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function normalizedPath(value: string): string {
  const portable = value.replaceAll('\\', '/');
  if (
    portable !== value ||
    !portable ||
    portable.startsWith('/') ||
    WINDOWS_ABSOLUTE.test(portable) ||
    portable.startsWith('./') ||
    portable.endsWith('/') ||
    portable.includes('//') ||
    portable.split('/').some((segment) => segment === '.' || segment === '..' || !segment)
  ) {
    throw new Error(`Repository input policy contains an unsafe path: ${value}`);
  }
  return portable;
}

function normalizedKinds(kinds: readonly RepositoryInputFileKind[]): RepositoryInputFileKind[] {
  if (kinds.length === 0) throw new Error('Repository input policy rule requires allowedKinds');
  const normalized = [...kinds].sort();
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('Repository input policy rule contains duplicate allowedKinds');
  }
  if (normalized.some((kind) => kind !== 'file')) {
    throw new Error('Repository input policy rule contains an unsupported file kind');
  }
  return normalized;
}

function overlaps(left: RepositoryInputPolicyRule, right: RepositoryInputPolicyRule): boolean {
  const leftPath = left.path.toLocaleLowerCase('en-US');
  const rightPath = right.path.toLocaleLowerCase('en-US');
  if (leftPath === rightPath) return true;
  if (left.match === 'tree' && rightPath.startsWith(`${leftPath}/`)) return true;
  return right.match === 'tree' && leftPath.startsWith(`${rightPath}/`);
}

export function compileRepositoryInputPolicy(
  contributors: readonly RepositoryInputPolicyContributor[],
): CompiledRepositoryInputPolicy {
  const identities = contributors.map(({ identity }) => {
    const id = identity.id.trim();
    const version = identity.version.trim();
    if (!IDENTIFIER.test(id)) throw new Error(`Invalid Repository Input Contributor id: ${id}`);
    if (!VERSION.test(version)) {
      throw new Error(`Invalid Repository Input Contributor version: ${id}`);
    }
    return { id, version };
  });
  if (new Set(identities.map(({ id }) => id)).size !== identities.length) {
    throw new Error('Repository Input Policy contains a duplicate Contributor');
  }

  const rules = contributors.flatMap((contributor) =>
    contributor.rules.map((rule) => {
      const id = rule.id.trim();
      const owner = rule.owner.trim();
      if (!IDENTIFIER.test(id)) throw new Error(`Invalid Repository Input Policy rule id: ${id}`);
      if (owner !== contributor.identity.id.trim()) {
        throw new Error(`Repository Input Policy rule ${id} has a mismatched owner`);
      }
      if (rule.match !== 'file' && rule.match !== 'tree') {
        throw new Error(`Repository Input Policy rule ${id} has an invalid match`);
      }
      if (rule.tracked !== 'product' && rule.tracked !== 'conflict') {
        throw new Error(`Repository Input Policy rule ${id} has an invalid tracked disposition`);
      }
      return {
        id,
        owner,
        path: normalizedPath(rule.path),
        match: rule.match,
        tracked: rule.tracked,
        allowedKinds: normalizedKinds(rule.allowedKinds),
      } satisfies RepositoryInputPolicyRule;
    }),
  );
  if (rules.length > MAX_RULES) throw new Error('Repository Input Policy has too many rules');
  if (new Set(rules.map(({ id }) => id)).size !== rules.length) {
    throw new Error('Repository Input Policy contains duplicate rule identities');
  }
  for (let left = 0; left < rules.length; left += 1) {
    for (let right = left + 1; right < rules.length; right += 1) {
      if (overlaps(rules[left]!, rules[right]!)) {
        throw new Error(
          `Repository Input Policy rules overlap: ${rules[left]!.id}, ${rules[right]!.id}`,
        );
      }
    }
  }

  const stable = {
    schemaVersion: 1 as const,
    contributors: identities.sort((left, right) => left.id.localeCompare(right.id)),
    rules: rules.sort((left, right) =>
      `${left.path.toLocaleLowerCase('en-US')}\0${left.id}`.localeCompare(
        `${right.path.toLocaleLowerCase('en-US')}\0${right.id}`,
      ),
    ),
  };
  return { ...stable, digest: digest(stable) };
}

export const EMPTY_REPOSITORY_INPUT_POLICY = compileRepositoryInputPolicy([]);

function matches(rule: RepositoryInputPolicyRule, candidate: string): boolean {
  const rulePath = rule.path.toLocaleLowerCase('en-US');
  const candidatePath = candidate.replaceAll('\\', '/').toLocaleLowerCase('en-US');
  return (
    candidatePath === rulePath ||
    (rule.match === 'tree' && candidatePath.startsWith(`${rulePath}/`))
  );
}

export function classifyRepositoryInput(
  policy: CompiledRepositoryInputPolicy,
  relativePath: string,
  tracked: boolean,
): RepositoryInputClassification {
  const rule = policy.rules.find((candidate) => matches(candidate, relativePath));
  if (!rule) return { kind: 'product' };
  if (tracked) {
    return rule.tracked === 'conflict'
      ? { kind: 'conflict', ruleId: rule.id, owner: rule.owner }
      : { kind: 'product' };
  }
  return { kind: 'control-plane', ruleId: rule.id, owner: rule.owner };
}
