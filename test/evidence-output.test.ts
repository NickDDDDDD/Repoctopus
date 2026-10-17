import { describe, expect, it } from 'vitest';

import { EvidenceRedactionError, redactEvidenceText } from '../domains/evidence/redaction.js';
import { BoundedTextCapture } from '../platform/feedback/bounded-text-capture.js';

describe('evidence output boundaries', () => {
  it('retains a bounded first and last line summary after truncation', () => {
    const capture = new BoundedTextCapture(100, 2, 64);
    for (let index = 0; index < 20; index += 1) capture.append(`line-${index}\n`);
    const result = capture.finish();
    expect(result.truncated).toBe(true);
    expect(result.bytesSeen).toBeGreaterThan(100);
    expect(result.contents).toContain('line-0');
    expect(result.contents).toContain('line-19');
    expect(result.contents).toContain('truncated');
    expect(result.contents).not.toContain('line-10');
  });

  it('redacts built-in secrets, configured values, paths and project patterns', () => {
    const result = redactEvidenceText(
      [
        'Authorization: Bearer secret-token',
        'Cookie: session=secret-cookie',
        'password=hunter2',
        'API_KEY=abc123',
        'value=company-secret',
        'path=C:\\workspace\\private-repo\\src',
        'customer-id=9988',
        '-----BEGIN PRIVATE KEY-----\nprivate bytes\n-----END PRIVATE KEY-----',
      ].join('\n'),
      {
        sensitiveValues: ['company-secret'],
        absolutePaths: ['C:\\workspace\\private-repo'],
        patterns: [/customer-id=\d+/u],
      },
    );
    expect(result.matches).toBeGreaterThanOrEqual(7);
    for (const secret of [
      'secret-token',
      'secret-cookie',
      'hunter2',
      'abc123',
      'company-secret',
      'private-repo',
      'customer-id=9988',
      'private bytes',
    ]) {
      expect(result.contents).not.toContain(secret);
    }
    expect(result.contents).toContain('Authorization: [REDACTED]');
  });

  it('rejects text that cannot be safely interpreted for redaction', () => {
    expect(() => redactEvidenceText('prefix\0binary')).toThrow(EvidenceRedactionError);
    expect(() => redactEvidenceText('invalid\uFFFDtext')).toThrow(EvidenceRedactionError);
  });
});
