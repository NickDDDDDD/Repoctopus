import type { EffectiveProjectConfig, EvidenceNodeConfig } from '../project-configuration/types.js';

export type PlannedEvidenceNode = EvidenceNodeConfig & { repositoryPath: string };

export interface EvidenceExecutionPlan {
  schemaVersion: 1;
  profileId: string;
  configDigest: string;
  nodes: PlannedEvidenceNode[];
  order: string[];
}

export class EvidenceProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidenceProfileError';
  }
}

export function compileEvidenceProfile(
  config: EffectiveProjectConfig,
  profileId: string,
): EvidenceExecutionPlan {
  const profile = config.shared.profiles.find((item) => item.id === profileId);
  if (!profile) throw new EvidenceProfileError(`Unknown evidence profile: ${profileId}`);

  const nodes = new Map<string, EvidenceNodeConfig>();
  for (const node of profile.nodes) {
    if (nodes.has(node.id)) throw new EvidenceProfileError(`Duplicate node id: ${node.id}`);
    nodes.set(node.id, node);
  }
  const repositories = new Map(
    config.repositories.map((repository) => [repository.id, repository.resolvedPath]),
  );
  for (const node of profile.nodes) {
    if (!repositories.has(node.repository)) {
      throw new EvidenceProfileError(
        `Node ${node.id} references unknown repository: ${node.repository}`,
      );
    }
    for (const dependency of node.dependsOn) {
      if (!nodes.has(dependency)) {
        throw new EvidenceProfileError(
          `Node ${node.id} references unknown dependency: ${dependency}`,
        );
      }
      if (dependency === node.id) {
        throw new EvidenceProfileError(`Node ${node.id} cannot depend on itself`);
      }
    }
    if (node.type === 'visual') {
      const browser = nodes.get(node.browserNode);
      if (!browser || browser.type !== 'browser') {
        throw new EvidenceProfileError(
          `Visual node ${node.id} references unknown browser node: ${node.browserNode}`,
        );
      }
      if (!node.dependsOn.includes(node.browserNode)) {
        throw new EvidenceProfileError(
          `Visual node ${node.id} must depend on browser node: ${node.browserNode}`,
        );
      }
    }
  }

  const indegree = new Map(profile.nodes.map((node) => [node.id, node.dependsOn.length]));
  const dependents = new Map(profile.nodes.map((node) => [node.id, [] as string[]]));
  for (const node of profile.nodes) {
    for (const dependency of node.dependsOn) dependents.get(dependency)!.push(node.id);
  }
  const ready = profile.nodes
    .filter((node) => node.dependsOn.length === 0)
    .map((node) => node.id)
    .sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const dependent of dependents.get(id)!.sort()) {
      const next = indegree.get(dependent)! - 1;
      indegree.set(dependent, next);
      if (next === 0) {
        ready.push(dependent);
        ready.sort();
      }
    }
  }
  if (order.length !== profile.nodes.length) {
    const cyclic = profile.nodes
      .map((node) => node.id)
      .filter((id) => !order.includes(id))
      .sort();
    throw new EvidenceProfileError(`Evidence profile contains a cycle: ${cyclic.join(', ')}`);
  }

  return {
    schemaVersion: 1,
    profileId,
    configDigest: config.effectiveDigest,
    nodes: profile.nodes.map((node) => ({
      ...structuredClone(node),
      repositoryPath: repositories.get(node.repository)!,
    })),
    order,
  };
}

export type DependencyResult = 'passed' | 'failed' | 'incomplete' | 'blocked';

export function blockedNodes(
  plan: EvidenceExecutionPlan,
  results: ReadonlyMap<string, DependencyResult>,
): string[] {
  const byId = new Map(plan.nodes.map((node) => [node.id, node]));
  return plan.order.filter((nodeId) => {
    const node = byId.get(nodeId)!;
    return node.dependsOn.some((dependency) => results.get(dependency) !== 'passed');
  });
}
