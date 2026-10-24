import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');

describe('archive infrastructure boundary', () => {
  it('does not register webhook, event Inbox, Runner, or Post-merge infrastructure', async () => {
    const sources = await Promise.all([
      readFile(path.join(root, 'plugins', 'builtin-catalog.ts'), 'utf8'),
      readFile(path.join(root, 'app', 'boot', 'project-composition.ts'), 'utf8'),
      readFile(path.join(root, 'app', 'cli', 'main.ts'), 'utf8'),
    ]);
    const productionEntryPoints = sources.join('\n');
    for (const removed of [
      'platform-event-runner',
      'github-webhook-route',
      'runner-application',
      'post-merge-coordinator',
      'post-merge-actions',
      'runner start',
      'event replay',
    ]) {
      expect(productionEntryPoints).not.toContain(removed);
    }
  });
});
