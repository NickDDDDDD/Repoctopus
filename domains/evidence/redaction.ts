export interface RedactionResult {
  contents: string;
  matches: number;
}

export class EvidenceRedactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidenceRedactionError';
  }
}

const SENSITIVE_PATTERNS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /\b(authorization\s*:\s*)(?:bearer\s+)?[^\s,;]+/giu,
    replacement: '$1[REDACTED]',
  },
  { pattern: /\b(cookie\s*:\s*)[^\r\n]+/giu, replacement: '$1[REDACTED]' },
  {
    pattern: /\b(password|token|api[_-]?key|secret)(\s*[=:]\s*)[^\s,;]+/giu,
    replacement: '$1$2[REDACTED]',
  },
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
    replacement: '[REDACTED PRIVATE KEY]',
  },
];

export interface RedactionOptions {
  sensitiveValues?: readonly string[];
  absolutePaths?: readonly string[];
  patterns?: readonly RegExp[];
}

function replaceLiteral(value: string, literal: string): { contents: string; matches: number } {
  if (literal === '') return { contents: value, matches: 0 };
  const matches = value.split(literal).length - 1;
  return { contents: value.split(literal).join('[REDACTED]'), matches };
}

export function redactEvidenceText(value: string, options: RedactionOptions = {}): RedactionResult {
  if (value.includes('\0') || value.includes('\uFFFD')) {
    throw new EvidenceRedactionError('Evidence text contains binary or invalid UTF-8 content');
  }
  let contents = value;
  let matches = 0;
  for (const entry of SENSITIVE_PATTERNS) {
    matches += [...contents.matchAll(entry.pattern)].length;
    contents = contents.replace(entry.pattern, entry.replacement);
  }
  for (const pattern of options.patterns ?? []) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    contents = contents.replace(new RegExp(pattern.source, flags), () => {
      matches += 1;
      return '[REDACTED]';
    });
  }
  const literals = [
    ...(options.sensitiveValues ?? []),
    ...(options.absolutePaths ?? []).flatMap((item) => [
      item,
      item.replaceAll('\\', '/'),
      item.replaceAll('/', '\\'),
    ]),
  ];
  for (const literal of new Set(literals)) {
    const result = replaceLiteral(contents, literal);
    contents = result.contents;
    matches += result.matches;
  }
  return { contents, matches };
}
