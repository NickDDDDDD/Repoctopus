import type { PublicationReceiptItem } from './publication-receipt.js';
import type { ChangeBranchReference, SpecificationClosureResult } from '../specification/types.js';

export interface SpecificationPublicationRequest {
  changeId: string;
  runId: string;
  workspaceRoot: string;
  changeBranch: ChangeBranchReference;
  closure: SpecificationClosureResult;
  remote: string;
  title: string;
  body: string;
}

export interface SpecificationPublicationResult {
  item: PublicationReceiptItem;
  expectedPublishedOid: string;
}
