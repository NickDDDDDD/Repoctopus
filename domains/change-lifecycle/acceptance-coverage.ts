import { createHash } from 'node:crypto';

import type { EvidenceExecutionPlan } from '../feedback/profile.js';
import type {
  SpecificationAcceptanceCriterion,
  SpecificationTask,
} from '../specification/types.js';
import { canonicalJson } from '../workflow-contract/canonical.js';

export interface AcceptanceCoverageResolution {
  acceptanceCriteria: readonly SpecificationAcceptanceCriterion[];
  acceptanceSetHash: `sha256:${string}`;
  acceptanceCoverage: readonly {
    acceptanceId: `acceptance-${string}`;
    nodeIds: readonly string[];
  }[];
}

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function approvedAcceptanceSet(tasks: readonly SpecificationTask[]) {
  const acceptanceCriteria = tasks
    .flatMap((task) => task.acceptanceCriteria.map((criterion) => structuredClone(criterion)))
    .sort((left, right) => left.acceptanceId.localeCompare(right.acceptanceId));
  if (acceptanceCriteria.length === 0) {
    throw new Error('Verification input requires at least one approved Acceptance criterion');
  }
  const ids = acceptanceCriteria.map((criterion) => criterion.acceptanceId);
  if (new Set(ids).size !== ids.length) {
    throw new Error('Verification input contains duplicate Acceptance identities');
  }
  return {
    acceptanceCriteria,
    acceptanceSetHash: sha256({ schemaVersion: 1, acceptanceCriteria }),
  };
}

export function resolveAcceptanceCoverage(
  tasks: readonly SpecificationTask[],
  plan: EvidenceExecutionPlan,
): AcceptanceCoverageResolution {
  const { acceptanceCriteria, acceptanceSetHash } = approvedAcceptanceSet(tasks);
  const nodeIdsByAcceptance = new Map(
    acceptanceCriteria.map(({ acceptanceId }) => [acceptanceId, new Set<string>()]),
  );
  for (const node of plan.nodes) {
    const selectors = node.covers ?? [];
    if (new Set(selectors).size !== selectors.length) {
      throw new Error(`Evidence node ${node.id} contains duplicate Acceptance selectors`);
    }
    for (const selector of selectors) {
      const matched = acceptanceCriteria.filter((criterion) => {
        if (selector === '*') return true;
        if (selector.startsWith('acceptance-')) return criterion.acceptanceId === selector;
        if (selector.startsWith('task:')) {
          return criterion.taskId === selector.slice('task:'.length);
        }
        if (selector.startsWith('requirement:')) {
          return criterion.requirementRefs.includes(selector.slice('requirement:'.length));
        }
        throw new Error(`Evidence node ${node.id} has an invalid Acceptance selector: ${selector}`);
      });
      if (matched.length === 0) {
        throw new Error(`Evidence node ${node.id} has an unknown Acceptance selector: ${selector}`);
      }
      if (node.required) {
        for (const criterion of matched) {
          nodeIdsByAcceptance.get(criterion.acceptanceId)!.add(node.id);
        }
      }
    }
  }
  const acceptanceCoverage = acceptanceCriteria.map((criterion) => ({
    acceptanceId: criterion.acceptanceId,
    nodeIds: [...nodeIdsByAcceptance.get(criterion.acceptanceId)!].sort(),
  }));
  const uncovered = acceptanceCoverage.filter((coverage) => coverage.nodeIds.length === 0);
  if (uncovered.length > 0) {
    throw new Error(
      `Verification Evidence Profile does not cover Acceptance: ${uncovered
        .map((coverage) => coverage.acceptanceId)
        .join(', ')}`,
    );
  }
  return {
    acceptanceCriteria,
    acceptanceSetHash,
    acceptanceCoverage,
  };
}
