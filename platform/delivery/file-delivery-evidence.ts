import type { DeliveryEvidencePort } from '../../domains/delivery/ports.js';
import { FileEvidenceStore } from '../evidence/file-evidence-store.js';

export class FileDeliveryEvidence implements DeliveryEvidencePort {
  private readonly store: FileEvidenceStore;

  constructor(workspace: string) {
    this.store = new FileEvidenceStore(workspace);
  }

  async assertSatisfied(bundleIds: readonly string[], compositionDigest: string): Promise<void> {
    const normalized = [...new Set(bundleIds)];
    if (normalized.length === 0 || normalized.some((id) => id.trim().length === 0)) {
      throw new Error('Delivery approval requires at least one Evidence Bundle');
    }
    for (const bundleId of normalized) {
      const bundle = await this.store.loadBundle(bundleId);
      if (bundle.compositionDigest !== compositionDigest) {
        throw new Error(
          `Evidence Bundle ${bundleId} belongs to composition ${bundle.compositionDigest}, not ${compositionDigest}`,
        );
      }
      if (bundle.outcome !== 'passed' && bundle.outcome !== 'passed_with_warnings') {
        throw new Error(`Evidence Bundle ${bundleId} does not satisfy delivery approval`);
      }
    }
  }
}
