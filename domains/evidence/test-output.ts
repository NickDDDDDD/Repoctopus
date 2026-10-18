export interface TestExecutionSummary {
  framework: 'maven-surefire' | 'jest' | 'vitest' | 'gradle' | 'generic';
  executed: number;
  source: string;
}

const TEST_COUNT_PATTERNS: Array<{
  framework: TestExecutionSummary['framework'];
  pattern: RegExp;
}> = [
  { framework: 'maven-surefire', pattern: /(?:^|\n)\s*Tests run:\s*(\d+)\b/iu },
  { framework: 'jest', pattern: /(?:^|\n)\s*Tests:\s*(\d+)\s+total\b/iu },
  { framework: 'vitest', pattern: /(?:^|\n)\s*Tests\s+(\d+)\s+(?:passed|failed|skipped)\b/iu },
  { framework: 'generic', pattern: /(?:^|\n)\s*(\d+)\s+tests?\s+(?:run|executed)\b/iu },
];

export function parseTestExecution(output: string): TestExecutionSummary | null {
  for (const candidate of TEST_COUNT_PATTERNS) {
    const match = candidate.pattern.exec(output);
    if (match?.[1] !== undefined) {
      return {
        framework: candidate.framework,
        executed: Number(match[1]),
        source: match[0].trim(),
      };
    }
  }
  const noTests = /(?:^|\n)\s*(No test files found|No tests found)\b/iu.exec(output);
  if (noTests) return { framework: 'generic', executed: 0, source: noTests[1]! };
  const mavenNoTests = /(?:^|\n)\s*(?:\[INFO\]\s*)?(No tests to run\.)\s*(?:\n|$)/iu.exec(output);
  if (mavenNoTests) {
    return { framework: 'maven-surefire', executed: 0, source: mavenNoTests[1]! };
  }
  const noSource = /(?:^|\n).*\btest\b.*\bNO-SOURCE\b/iu.exec(output);
  if (noSource) return { framework: 'gradle', executed: 0, source: noSource[0].trim() };
  return null;
}
