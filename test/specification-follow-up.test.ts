import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Context } from '@deepseek-ai/cordis';
import { afterEach, describe, expect, it } from 'vitest';

import { OpenSpecProvider } from '../platform/specification/openspec-provider.js';
import type { SpecificationProcessPort } from '../platform/specification/openspec-process.js';

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe('semantic compensation through an ordinary OpenSpec Change', () => {
  it('opens a standard Open lifecycle entry and leaves the archived Change untouched', async () => {
    const workspace = await (async () => {
      const root = path.join(tmpdir(), `repoctopus-follow-up-${randomUUID()}`);
      roots.push(root);
      await mkdir(path.join(root, 'openspec', 'changes', 'archive', '2026-10-24-original'), {
        recursive: true,
      });
      await writeFile(
        path.join(root, 'openspec', 'changes', 'archive', '2026-10-24-original', 'proposal.md'),
        '# Original\n',
        'utf8',
      );
      return root;
    })();
    const commands: string[][] = [];
    const process: SpecificationProcessPort = {
      execute: async (args, options) => {
        commands.push([...args]);
        if (args[0] === 'context') {
          return {
            exitCode: 0,
            stdout: JSON.stringify({ root: { path: options.cwd, store_id: 'team' } }),
            stderr: '',
          };
        }
        if (args[0] === 'new' && args[1] === 'change') {
          await mkdir(path.join(options.cwd, 'openspec', 'changes', args[2]!), { recursive: true });
          return { exitCode: 0, stdout: JSON.stringify({ change: args[2] }), stderr: '' };
        }
        throw new Error(`Unexpected OpenSpec command: ${args.join(' ')}`);
      },
    };
    const context = new Context();
    await context.plugin(OpenSpecProvider, {
      workspaceRoot: workspace,
      specificationRoot: {
        schemaVersion: 1,
        kind: 'SpecificationRoot',
        storeId: 'team',
        repositoryId: 'workspace',
      },
      process,
    });
    const archivedBefore = await readFile(
      path.join(workspace, 'openspec', 'changes', 'archive', '2026-10-24-original', 'proposal.md'),
      'utf8',
    );
    const followUp = await context.specification.openFollowUp({
      changeId: 'reconcile-original-a1b2c3d4',
      originalChangeId: 'original',
      publicationReceiptDigest: `sha256:${'a'.repeat(64)}`,
      affectedMergeRequests: [
        {
          provider: 'github',
          repositoryId: 'app',
          number: 17,
          url: 'https://github.com/team/app/pull/17',
        },
      ],
      rationale: 'The accepted API response changed after publication.',
    });
    expect(commands).toEqual([
      ['context', '--json', '--store', 'team'],
      ['new', 'change', 'reconcile-original-a1b2c3d4', '--store', 'team', '--json'],
    ]);
    expect(followUp).toMatchObject({
      status: 'opened',
      lifecycleEntry: 'open',
      originalChangeId: 'original',
    });
    const proposal = await readFile(
      path.join(workspace, 'openspec', 'changes', followUp.changeId, 'proposal.md'),
      'utf8',
    );
    expect(proposal).toContain('标准 Open 阶段进入 Design 审批');
    expect(proposal).toContain('original');
    expect(proposal).toContain('github:app#17');
    expect(
      await readFile(
        path.join(
          workspace,
          'openspec',
          'changes',
          'archive',
          '2026-10-24-original',
          'proposal.md',
        ),
        'utf8',
      ),
    ).toBe(archivedBefore);
    await context.fiber.dispose();
  });
});
