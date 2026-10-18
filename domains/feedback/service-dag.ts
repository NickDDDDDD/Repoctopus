import type {
  ManagedServiceRequest,
  ManagedServiceSession,
  ServiceObservation,
} from './service.js';

export interface ManagedServiceNode {
  id: string;
  dependsOn: readonly string[];
  request: ManagedServiceRequest;
}

export interface ManagedServicePlan {
  nodes: ManagedServiceNode[];
  order: string[];
}

export interface ManagedServiceNodeResult {
  nodeId: string;
  status: 'ready' | 'failed' | 'timed_out' | 'blocked';
  observation?: ServiceObservation;
  blockedBy?: string[];
  error?: string;
}

export interface ManagedServiceDagRun {
  results: ReadonlyMap<string, ManagedServiceNodeResult>;
  sessions: ReadonlyMap<string, ManagedServiceSession>;
  close(): Promise<ServiceObservation[]>;
}

export function compileManagedServiceDag(input: readonly ManagedServiceNode[]): ManagedServicePlan {
  const nodes = new Map<string, ManagedServiceNode>();
  for (const node of input) {
    if (nodes.has(node.id)) throw new Error(`Duplicate managed service node: ${node.id}`);
    nodes.set(node.id, node);
  }
  for (const node of input) {
    for (const dependency of node.dependsOn) {
      if (!nodes.has(dependency)) {
        throw new Error(`Managed service ${node.id} has unknown dependency: ${dependency}`);
      }
      if (dependency === node.id) {
        throw new Error(`Managed service ${node.id} cannot depend on itself`);
      }
    }
  }
  const indegree = new Map(input.map((node) => [node.id, node.dependsOn.length]));
  const dependents = new Map(input.map((node) => [node.id, [] as string[]]));
  for (const node of input) {
    for (const dependency of node.dependsOn) dependents.get(dependency)!.push(node.id);
  }
  const ready = input
    .filter((node) => node.dependsOn.length === 0)
    .map((node) => node.id)
    .sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const dependent of dependents.get(id)!.sort()) {
      const remaining = indegree.get(dependent)! - 1;
      indegree.set(dependent, remaining);
      if (remaining === 0) {
        ready.push(dependent);
        ready.sort();
      }
    }
  }
  if (order.length !== input.length) throw new Error('Managed service graph contains a cycle');
  return {
    nodes: input.map((node) => structuredClone(node)),
    order,
  };
}
