import { PassThrough } from 'node:stream';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { reviewHumanDecision } from '../app/cli/human-decision.js';
import type { HumanDecisionRequest } from '../domains/delivery/types.js';

const request: HumanDecisionRequest = {
  apiVersion: 'repoctopus/v1alpha1',
  kind: 'HumanDecisionRequest',
  requestId: 'request',
  decisionType: 'delivery-approval',
  changeId: 'delivery-change',
  snapshotDigest: `sha256:${'a'.repeat(64)}`,
  reportDigest: `sha256:${'b'.repeat(64)}`,
  repositories: [],
  actions: [],
  options: ['approve', 'request_changes', 'reject'],
};

describe('interactive human decision', () => {
  it.each([
    ['1', 'looks good', 'approve'],
    ['2', 'fix tests', 'request_changes'],
    ['3', 'unsafe', 'reject'],
  ] as const)('maps TTY choice %s to %s', async (choice, comment, decision) => {
    const input = new PassThrough();
    const output = new PassThrough();
    const reviewed = reviewHumanDecision({ request, input, output });
    input.write(`${choice}\n`);
    setTimeout(() => input.write(`${comment}\n`), 5);
    await expect(reviewed).resolves.toMatchObject({ decision, comment });
    input.end();
  });

  it('rejects an unknown choice instead of defaulting to approval', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const reviewed = reviewHumanDecision({ request, input, output });
    input.end('yes\n');
    await expect(reviewed).rejects.toThrow(/must be 1, 2, or 3/i);
  });

  it('keeps request and response schema digests algorithm-qualified', async () => {
    const root = path.resolve(import.meta.dirname, '..');
    const schemas = await Promise.all([
      readFile(path.join(root, 'docs', 'schemas', 'human-decision-request.schema.json'), 'utf8'),
      readFile(path.join(root, 'docs', 'schemas', 'human-decision-response.schema.json'), 'utf8'),
    ]);
    for (const source of schemas) {
      const schema = JSON.parse(source) as {
        properties: { snapshotDigest: { pattern: string }; actor?: unknown };
      };
      expect(
        new RegExp(schema.properties.snapshotDigest.pattern).test(request.snapshotDigest),
      ).toBe(true);
      expect(schema.properties.actor).toBeUndefined();
    }
  });
});
