export interface RedactionResult {
  contents: string;
  matches: number;
}

const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /\b(authorization\s*:\s*)(?:bearer\s+)?[^\s,;]+/gi,
  /\b(cookie\s*:\s*)[^\r\n]+/gi,
  /\b(password|token|api[_-]?key|secret)\s*[=:]\s*[^\s,;]+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

export function redactEvidenceText(value: string): RedactionResult {
  let contents = value;
  let matches = 0;
  for (const pattern of SENSITIVE_PATTERNS) {
    contents = contents.replace(pattern, (matched, prefix: string | undefined) => {
      matches += 1;
      return prefix ? `${prefix}[REDACTED]` : '[REDACTED]';
    });
  }
  return { contents, matches };
}
