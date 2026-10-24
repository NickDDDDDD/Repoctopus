import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');

async function source(relative: string): Promise<string> {
  return readFile(path.join(root, relative), 'utf8');
}

describe('archive simplification characterization baseline', () => {
  it('records the merge wait that the replacement lifecycle must remove', async () => {
    const definition = await source('domains/change-lifecycle/definition.ts');
    expect(definition).toContain("'delivery.await-merge'");
    expect(definition).toContain("trigger: 'business-publication-receipts-accepted'");
  });

  it('records the webhook runner composition that must be retired', async () => {
    const composition = await source('app/boot/project-composition.ts');
    expect(composition).toContain("id: 'github-webhook-route'");
    expect(composition).toContain("id: 'platform-event-runner'");
    expect(composition).toContain('compileRunnerComposition');
  });

  it('records that run start currently reconciles before parsing required change options', async () => {
    const cli = await source('app/cli/main.ts');
    const start = cli.slice(cli.indexOf('async function runStart'), cli.indexOf('async function postMergeReconcile'));
    expect(start.indexOf('bootProjectComposition')).toBeLessThan(start.indexOf("stringFlag(parsed, 'change')"));
    expect(start).toContain("'post-merge.reconcile'");
  });
});
