import type {
  ManagedServiceDagRun,
  ManagedServiceNode,
  ManagedServiceNodeResult,
  ManagedServicePlan,
} from '../../domains/feedback/service-dag.js';
import { compileManagedServiceDag } from '../../domains/feedback/service-dag.js';
import type {
  ManagedServiceSession,
  ServiceAdapter,
  ServiceObservation,
} from '../../domains/feedback/service.js';

class LocalManagedServiceDagRun implements ManagedServiceDagRun {
  private closed = false;

  constructor(
    readonly results: ReadonlyMap<string, ManagedServiceNodeResult>,
    readonly sessions: ReadonlyMap<string, ManagedServiceSession>,
    private readonly plan: ManagedServicePlan,
  ) {}

  async close(): Promise<ServiceObservation[]> {
    if (this.closed) return [];
    this.closed = true;
    const stopped: ServiceObservation[] = [];
    for (const nodeId of [...this.plan.order].reverse()) {
      const session = this.sessions.get(nodeId);
      if (session) stopped.push(await session.stop());
    }
    return stopped;
  }
}

export class ManagedServiceDagRunner {
  constructor(private readonly adapter: ServiceAdapter) {}

  async run(nodes: readonly ManagedServiceNode[]): Promise<ManagedServiceDagRun> {
    const plan = compileManagedServiceDag(nodes);
    const byId = new Map(plan.nodes.map((node) => [node.id, node]));
    const pending = new Set(plan.order);
    const results = new Map<string, ManagedServiceNodeResult>();
    const sessions = new Map<string, ManagedServiceSession>();

    while (pending.size > 0) {
      for (const nodeId of [...pending]) {
        const node = byId.get(nodeId)!;
        const completedDependencies = node.dependsOn.filter((dependency) =>
          results.has(dependency),
        );
        if (completedDependencies.length !== node.dependsOn.length) continue;
        const blockedBy = node.dependsOn.filter(
          (dependency) => results.get(dependency)?.status !== 'ready',
        );
        if (blockedBy.length > 0) {
          results.set(nodeId, { nodeId, status: 'blocked', blockedBy });
          pending.delete(nodeId);
        }
      }

      const ready = [...pending].filter((nodeId) =>
        byId
          .get(nodeId)!
          .dependsOn.every((dependency) => results.get(dependency)?.status === 'ready'),
      );
      if (ready.length === 0) {
        if (pending.size === 0) break;
        throw new Error(`Managed service graph stalled: ${[...pending].join(', ')}`);
      }
      await Promise.all(
        ready.map(async (nodeId) => {
          const node = byId.get(nodeId)!;
          pending.delete(nodeId);
          try {
            const session = await this.adapter.startManaged(node.request);
            const observation = await session.waitUntilReady();
            results.set(nodeId, { nodeId, status: observation.status, observation });
            if (observation.status === 'ready') sessions.set(nodeId, session);
            else await session.stop();
          } catch (error) {
            results.set(nodeId, {
              nodeId,
              status: 'failed',
              error: (error as Error).message,
            });
          }
        }),
      );
    }

    return new LocalManagedServiceDagRun(results, sessions, plan);
  }
}
