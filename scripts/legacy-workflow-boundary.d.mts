export interface LegacyWorkflowPathRule {
  path: string;
  match: 'file' | 'tree';
  ownership: 'external-exclusive';
}

export function evaluateLegacyWorkflowProductBoundary(input: {
  rules?: readonly LegacyWorkflowPathRule[];
  headPaths?: readonly string[];
  indexPaths?: readonly string[];
}): string[];
