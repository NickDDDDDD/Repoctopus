import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { DeliveryEvent } from '../domains/delivery/ports.js';
import { initialDeliveryState } from '../domains/delivery/state.js';
import { FileDeliveryStore } from '../platform/delivery/file-delivery-store.js';
import {
  createGitRepository,
  removeTemporaryDirectory,
  temporaryDirectory,
} from './helpers/fixtures.js';
import { runCli } from './e2e/cli.js';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

describe('Post-merge operator documentation', () => {
  it('keeps local links resolvable and status/recovery commands executable', async () => {
    const documentationPath = path.join(repositoryRoot, 'docs', 'post-merge.md');
    const documentation = await readFile(documentationPath, 'utf8');
    const links = [...documentation.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)]
      .map((match) => match[1]!)
      .filter((target) => !/^[a-z]+:/iu.test(target) && !target.startsWith('#'));
    for (const target of links) {
      await expect(access(path.resolve(path.dirname(documentationPath), target))).resolves.toBe(
        undefined,
      );
    }

    for (const command of [
      'event status',
      'event retry',
      'delivery status',
      'run status',
      'run resume',
      'evidence status',
      'evidence resume',
    ]) {
      expect(documentation).toContain(`node bin/repoctopus.js ${command}`);
    }

    const root = await temporaryDirectory('repoctopus-post-merge-docs-');
    cleanup.push(root);
    const project = path.join(root, 'project');
    const workspace = await createGitRepository(project, 'workspace');
    await createGitRepository(project, 'service');
    await writeFile(
      path.join(workspace, 'repoctopus.yaml'),
      JSON.stringify({
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'RepoctopusProject',
        project: { id: 'post-merge-docs' },
        repositories: [{ id: 'service', path: '../service' }],
        profiles: [
          {
            id: 'verify',
            nodes: [
              {
                id: 'check',
                type: 'command',
                repository: 'service',
                executable: process.execPath,
                args: ['-e', 'process.exit(0)'],
              },
            ],
          },
        ],
      }),
    );

    const runId = 'post-merge-docs-run';
    await runCli({
      packageRoot: repositoryRoot,
      cwd: workspace,
      args: ['run', 'start', '--workspace', workspace, '--project-root', project, '--run', runId],
    });
    const runStatus = await runCli<{ state: { runId: string } }>({
      packageRoot: repositoryRoot,
      cwd: workspace,
      args: ['run', 'status', '--workspace', workspace, '--run', runId],
    });
    expect(runStatus.result?.state.runId).toBe(runId);
    const resumedRun = await runCli<{ state: { runId: string } }>({
      packageRoot: repositoryRoot,
      cwd: workspace,
      args: ['run', 'resume', '--workspace', workspace, '--project-root', project, '--run', runId],
    });
    expect(resumedRun.result?.state.runId).toBe(runId);

    const attemptId = 'post-merge-docs-attempt';
    await runCli({
      packageRoot: repositoryRoot,
      cwd: workspace,
      args: [
        'evidence',
        'run',
        '--workspace',
        workspace,
        '--profile',
        'verify',
        '--attempt',
        attemptId,
      ],
    });
    const evidenceStatus = await runCli<{ attempt: { attemptId: string } }>({
      packageRoot: repositoryRoot,
      cwd: workspace,
      args: ['evidence', 'status', '--workspace', workspace, '--attempt', attemptId],
    });
    expect(evidenceStatus.result?.attempt.attemptId).toBe(attemptId);
    const resumedEvidence = await runCli<{ attempt: { attemptId: string } }>({
      packageRoot: repositoryRoot,
      cwd: workspace,
      args: ['evidence', 'resume', '--workspace', workspace, '--attempt', attemptId],
    });
    expect(resumedEvidence.result?.attempt.attemptId).toBe(attemptId);

    const deliveryState = initialDeliveryState('post-merge-docs', '2026-01-01T00:00:00.000Z');
    const deliveryEvent: DeliveryEvent = {
      schemaVersion: 1,
      eventId: 'post-merge-docs-created',
      changeId: deliveryState.changeId,
      stateVersion: deliveryState.stateVersion,
      timestamp: deliveryState.updatedAt,
      type: 'delivery.prepared',
      data: {},
    };
    await new FileDeliveryStore(workspace).commit({
      state: deliveryState,
      previousStateVersion: null,
      event: deliveryEvent,
    });
    const deliveryStatus = await runCli<{ changeId: string }>({
      packageRoot: repositoryRoot,
      cwd: workspace,
      args: ['delivery', 'status', '--workspace', workspace, '--change', deliveryState.changeId],
    });
    expect(deliveryStatus.result?.changeId).toBe(deliveryState.changeId);
  }, 60_000);
});
