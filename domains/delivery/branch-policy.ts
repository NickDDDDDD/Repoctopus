const MAX_PROTECTED_BRANCH_PATTERNS = 256;
const MAX_PROTECTED_BRANCH_PATTERN_LENGTH = 512;

function branchPattern(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/gu, '\\$&')
    .replaceAll('*', '.*')
    .replaceAll('?', '.');
  return new RegExp(`^${escaped}$`);
}

export function normalizeProtectedBranchPatterns(
  patterns: readonly string[],
  targetBranch?: string | null,
): readonly string[] {
  if (patterns.length > MAX_PROTECTED_BRANCH_PATTERNS) {
    throw new Error(`Protected branch policy exceeds ${MAX_PROTECTED_BRANCH_PATTERNS} patterns`);
  }
  const candidates = [...patterns, ...(targetBranch === undefined ? [] : [targetBranch ?? ''])];
  const normalized = candidates.map((pattern) => pattern.trim());
  if (normalized.some((pattern) => pattern.length === 0)) {
    throw new Error('Protected branch policy contains an empty pattern');
  }
  if (normalized.some((pattern) => pattern.length > MAX_PROTECTED_BRANCH_PATTERN_LENGTH)) {
    throw new Error(
      `Protected branch pattern exceeds ${MAX_PROTECTED_BRANCH_PATTERN_LENGTH} characters`,
    );
  }
  return Object.freeze([...new Set(normalized)].sort());
}

export function isProtectedBranch(branch: string, patterns: readonly string[]): boolean {
  const normalizedBranch = branch.trim();
  if (!normalizedBranch) throw new Error('Branch identity is required');
  return normalizeProtectedBranchPatterns(patterns).some((pattern) =>
    branchPattern(pattern).test(normalizedBranch),
  );
}
