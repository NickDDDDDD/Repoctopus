import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { ProjectDetectionDraft } from '../../domains/project-configuration/detection.js';
import type { ProjectConfigurationDecisionRequest } from '../../domains/project-configuration/onboarding.js';
import type { SharedProjectConfig } from '../../domains/project-configuration/types.js';
import { applyProjectConfigurationDecision } from '../../platform/project-configuration/onboarding.js';
import {
  createGitRepository,
  removeTemporaryDirectory,
  temporaryDirectory,
} from '../helpers/fixtures.js';
import { runCli } from './cli.js';

const packageRoot = path.resolve(import.meta.dirname, '..', '..');
const cleanup: string[] = [];

afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

describe('documented project onboarding flow', () => {
  it('runs detect, Agent completion, trusted confirmation and first Evidence', async () => {
    const root = await temporaryDirectory('repoctopus-onboarding-flow-');
    cleanup.push(root);
    const app = await createGitRepository(root, 'app');
    await writeFile(
      path.join(app, 'package.json'),
      JSON.stringify({ scripts: { build: 'placeholder-build' } }),
    );
    const workspace = await createGitRepository(root, 'workspace');

    const detection = await runCli({
      packageRoot,
      cwd: workspace,
      args: ['project', 'detect', '--root', root, '--workspace', workspace],
    });
    const detected = detection.result as { draft: ProjectDetectionDraft; file: string };
    expect(detection).toMatchObject({ ok: true, command: 'project detect' });
    expect(detected.draft.status).toBe('candidate');

    const candidate: SharedProjectConfig = {
      ...detected.draft.candidateConfig!,
      workspace: { ...detected.draft.candidateConfig!.workspace, id: 'onboarding-flow' },
      profiles: [
        {
          id: 'verify',
          nodes: [
            {
              id: 'app-build',
              type: 'command',
              repository: 'app',
              dependsOn: [],
              required: true,
              executable: process.execPath,
              args: ['-e', "process.stdout.write('first evidence')"],
              timeoutMs: 5000,
              cache: false,
            },
          ],
        },
      ],
    };
    const candidateFile = path.join(workspace, '.repoctopus', 'drafts', 'candidate.yaml');
    await writeFile(candidateFile, JSON.stringify(candidate));
    const preparedEnvelope = await runCli({
      packageRoot,
      cwd: workspace,
      args: [
        'project',
        'prepare',
        '--workspace',
        workspace,
        '--draft',
        detected.file,
        '--candidate',
        candidateFile,
      ],
    });
    const prepared = preparedEnvelope.result as {
      request: ProjectConfigurationDecisionRequest;
      file: string;
    };
    expect(preparedEnvelope).toMatchObject({
      protocolVersion: 1,
      ok: true,
      command: 'project prepare',
      result: {
        request: { kind: 'HumanDecisionRequest', decisionType: 'project-configuration' },
      },
    });

    await applyProjectConfigurationDecision({
      workspace,
      decisionFile: prepared.file,
      response: {
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'HumanDecisionResponse',
        requestId: prepared.request.requestId,
        snapshotDigest: prepared.request.snapshotDigest,
        decision: 'approve',
      },
      actor: { actorId: 'fixture-user', source: 'ide', authenticated: true },
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    const evidence = await runCli({
      packageRoot,
      cwd: workspace,
      args: ['evidence', 'run', '--workspace', workspace, '--profile', 'verify'],
    });
    expect(evidence).toMatchObject({
      protocolVersion: 1,
      ok: true,
      command: 'evidence run',
      result: { bundle: { outcome: 'passed' } },
    });
  }, 30_000);
});
