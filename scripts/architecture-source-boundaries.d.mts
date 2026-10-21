export interface ArchitectureSource {
  path: string;
  contents: string;
}

export interface ArchitectureSourceBoundaryRule {
  id: string;
  targets?: string[];
  pattern: string;
  allowed: string[];
  exactMatches?: number;
  message: string;
}

export function evaluateSourceBoundaries(
  sources: ArchitectureSource[],
  rules: ArchitectureSourceBoundaryRule[] | undefined,
): string[];
