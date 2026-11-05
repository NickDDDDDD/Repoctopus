import { createHash } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';
import type { SpecificationTaskSet } from './types.js';

export type DeltaOperation = 'ADDED' | 'MODIFIED' | 'REMOVED' | 'RENAMED';

export interface RequirementIdentity {
  capabilityId: string;
  title: string;
  operation: DeltaOperation | 'CURRENT';
  identity: string;
}

export interface CapabilityPlanningInput {
  capabilityId: string;
  existed: boolean;
  purpose: string | null;
  requirements: readonly RequirementIdentity[];
}

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function parseRequirementIdentities(
  capabilityId: string,
  source: string,
  fallbackOperation: DeltaOperation | 'CURRENT' = 'CURRENT',
): RequirementIdentity[] {
  let operation: RequirementIdentity['operation'] = fallbackOperation;
  const identities: RequirementIdentity[] = [];
  for (const line of source.replaceAll('\r\n', '\n').split('\n')) {
    const section = /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\s*$/iu.exec(line);
    if (section) {
      operation = section[1]!.toUpperCase() as DeltaOperation;
      continue;
    }
    const heading = /^###\s+Requirement:\s*(.+?)\s*$/iu.exec(line);
    if (!heading) continue;
    const title = heading[1]!.trim();
    if (!title) throw new Error(`Capability ${capabilityId} contains an empty Requirement title`);
    const slug = title
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
      .replace(/^-+|-+$/gu, '');
    if (!slug) throw new Error(`Capability ${capabilityId} contains an invalid Requirement title`);
    identities.push({ capabilityId, title, operation, identity: `${capabilityId}#${slug}` });
  }
  const duplicate = identities.find(
    (entry, index) =>
      identities.findIndex((candidate) => candidate.identity === entry.identity) !== index,
  );
  if (duplicate) throw new Error(`Requirement identity is duplicated: ${duplicate.identity}`);
  return identities.sort((left, right) => left.identity.localeCompare(right.identity));
}

export function resolveTaskRequirementIdentities(
  tasks: SpecificationTaskSet,
  requirements: readonly RequirementIdentity[],
): SpecificationTaskSet {
  const exact = new Map(requirements.map((entry) => [entry.identity, entry.identity] as const));
  const aliases = new Map<string, string[]>();
  for (const requirement of requirements) {
    aliases.set(requirement.title, [
      ...(aliases.get(requirement.title) ?? []),
      requirement.identity,
    ]);
  }
  const resolve = (reference: string): string => {
    const separator = reference.indexOf('#');
    const qualified =
      separator > 0
        ? `${reference.slice(0, separator)}#${reference
            .slice(separator + 1)
            .normalize('NFKC')
            .toLowerCase()
            .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
            .replace(/^-+|-+$/gu, '')}`
        : reference;
    const canonical = exact.get(qualified);
    if (canonical) return canonical;
    const candidates = aliases.get(reference) ?? [];
    if (candidates.length === 1) return candidates[0]!;
    if (candidates.length > 1)
      throw new Error(`Task Requirement reference is ambiguous: ${reference}`);
    throw new Error(`Task Requirement reference is unknown: ${reference}`);
  };
  const projected = tasks.tasks.map((task) => {
    const requirementRefs = [...new Set(task.requirementRefs.map(resolve))].sort();
    return {
      ...task,
      requirementRefs,
      acceptanceCriteria: task.acceptanceCriteria.map((criterion) => ({
        ...criterion,
        requirementRefs,
      })),
    };
  });
  return {
    ...tasks,
    tasks: projected,
    digest: sha256({
      schemaVersion: tasks.schemaVersion,
      changeId: tasks.changeId,
      tasks: projected.map(({ completion: _completion, status: _status, ...task }) => task),
    }),
  };
}

export interface SpecificationClosurePreflight {
  valid: boolean;
  requirementIdentities: readonly string[];
  newCapabilityPurposes: Readonly<Record<string, string>>;
  retiredCapabilities: readonly string[];
  diagnostics: readonly string[];
  digest: `sha256:${string}`;
}

export function analyzeSpecificationClosure(
  capabilities: readonly CapabilityPlanningInput[],
): SpecificationClosurePreflight {
  const diagnostics: string[] = [];
  const purposes: Record<string, string> = {};
  const retired: string[] = [];
  for (const capability of [...capabilities].sort((a, b) =>
    a.capabilityId.localeCompare(b.capabilityId),
  )) {
    const operations = new Set(capability.requirements.map((entry) => entry.operation));
    if (!capability.existed) {
      const purpose = capability.purpose?.trim();
      if (!purpose) diagnostics.push(`New capability ${capability.capabilityId} requires Purpose`);
      else purposes[capability.capabilityId] = purpose;
      if (operations.has('MODIFIED') || operations.has('REMOVED')) {
        diagnostics.push(`New capability ${capability.capabilityId} has invalid delta operations`);
      }
    }
    if (operations.size > 0 && [...operations].every((operation) => operation === 'REMOVED')) {
      retired.push(capability.capabilityId);
    }
  }
  const stable = {
    valid: diagnostics.length === 0,
    requirementIdentities: capabilities
      .flatMap((entry) => entry.requirements.map((item) => item.identity))
      .sort(),
    newCapabilityPurposes: purposes,
    retiredCapabilities: retired.sort(),
    diagnostics: diagnostics.sort(),
  };
  return { ...stable, digest: sha256(stable) };
}
