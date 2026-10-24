import { createHash } from 'node:crypto';

import { Service, type Context } from '@deepseek-ai/cordis';

import {
  createConsistencyReviewRequest,
  type ConsistencyMergeRequestObservation,
  type ConsistencyReviewRequest,
} from '../domains/consistency/review.js';
import type { RuntimeDiagnostic } from '../domains/runtime/types.js';
import { canonicalJson } from '../domains/workflow-contract/canonical.js';
import { FileConsistencyStore } from '../platform/consistency/file-consistency-store.js';
import type { PublicationReceipt } from '../domains/delivery/publication-receipt.js';
import type { MergeRequestStatus } from '../domains/delivery/types.js';

export interface ConsistencyReconciliationResult {
  checked: number;
  unchanged: number;
  reviewRequests: ConsistencyReviewRequest[];
  diagnostics: RuntimeDiagnostic[];
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export async function reconcilePublicationReceipts(input: {
  publications: readonly PublicationReceipt[];
  changeId?: string;
  observe: (item: PublicationReceipt['items'][number]) => Promise<MergeRequestStatus>;
  saveRequest: (request: ConsistencyReviewRequest) => Promise<void>;
  now?: () => Date;
}): Promise<ConsistencyReconciliationResult> {
  const publications = input.publications.filter(
    (receipt) => !input.changeId || receipt.changeId === input.changeId,
  );
  const reviewRequests: ConsistencyReviewRequest[] = [];
  const diagnostics: RuntimeDiagnostic[] = [];
  let unchanged = 0;
  for (const receipt of publications) {
    try {
      const observations: ConsistencyMergeRequestObservation[] = [];
      for (const item of receipt.items.filter((candidate) => candidate.role === 'business')) {
        const current = await input.observe(item);
        observations.push({
          publicationId: item.publicationId,
          repositoryId: item.repositoryId,
          provider: item.mergeRequest.provider,
          number: item.mergeRequest.number,
          url: item.mergeRequest.url,
          sourceBranch: item.sourceBranch,
          targetBranch: item.targetBranch,
          publishedHeadOid: item.publishedOid,
          currentHeadOid: current.headCommit ?? item.publishedOid,
          currentState: current.state,
          observedAt: (input.now ?? (() => new Date()))().toISOString(),
          changeEvidence: {
            summary:
              current.headCommit === item.publishedOid
                ? `MR state observed as ${current.state}; published head is unchanged`
                : 'MR head changed after publication; semantic review is required',
            diffDigest: digest({
              publicationId: item.publicationId,
              publishedHeadOid: item.publishedOid,
              currentHeadOid: current.headCommit ?? null,
              currentState: current.state,
            }),
            categories: current.headCommit === item.publishedOid ? ['implementation'] : ['mixed'],
          },
        });
      }
      if (observations.every((item) => item.currentHeadOid === item.publishedHeadOid)) {
        unchanged += 1;
        continue;
      }
      const request = createConsistencyReviewRequest({ receipt, observations });
      await input.saveRequest(request);
      reviewRequests.push(request);
    } catch (error) {
      diagnostics.push({
        level: 'warning',
        code: 'consistency.reconcile-unavailable',
        message: `${receipt.changeId}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return { checked: publications.length, unchanged, reviewRequests, diagnostics };
}

export class ConsistencyReconciler extends Service {
  static inject = ['delivery'];
  private readonly store: FileConsistencyStore;

  constructor(context: Context, config: { workspaceRoot: string }) {
    super(context, 'consistencyReconciler');
    this.store = new FileConsistencyStore(config.workspaceRoot);
  }

  async reconcile(
    input: { changeId?: string } = {},
    signal?: AbortSignal,
  ): Promise<ConsistencyReconciliationResult> {
    return reconcilePublicationReceipts({
      publications: await this.store.publications(),
      ...(input.changeId ? { changeId: input.changeId } : {}),
      observe: async (item) => {
        signal?.throwIfAborted();
        return this.ctx.delivery.observePublication(item, signal);
      },
      saveRequest: (request) => this.store.saveRequest(request),
    });
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    consistencyReconciler: ConsistencyReconciler;
  }
}
