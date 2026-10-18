import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import {
  hashProjectConfig,
  parseSharedProjectConfig,
} from '../domains/project-configuration/config.js';
import type { ProjectConfigurationDecisionResponse } from '../domains/project-configuration/onboarding.js';
import {
  createGitRepository,
  removeTemporaryDirectory,
  temporaryDirectory,
} from './helpers/fixtures.js';
import { detectProjectConfiguration } from '../platform/project-configuration/detect.js';
import { loadProjectConfig } from '../platform/project-configuration/file-config.js';
import {
  applyProjectConfigurationDecision,
  prepareProjectConfigurationDecision,
} from '../platform/project-configuration/onboarding.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

function response(
  request: Awaited<ReturnType<typeof prepareProjectConfigurationDecision>>['request'],
): ProjectConfigurationDecisionResponse {
  return {
    apiVersion: 'repoctopus/v1alpha1',
    kind: 'HumanDecisionResponse',
    requestId: request.requestId,
    snapshotDigest: request.snapshotDigest,
    decision: 'approve',
  };
}

describe('project configuration onboarding', () => {
  it('keeps an Agent-completed candidate pending until a trusted bound decision approves it', async () => {
    const root = await temporaryDirectory('repoctopus-onboarding-');
    cleanup.push(root);
    const workspace = await createGitRepository(root, 'workspace');
    const frontend = await createGitRepository(root, 'web-front');
    await writeFile(
      path.join(frontend, 'package.json'),
      JSON.stringify({ scripts: { build: 'vite build' } }),
    );
    const detected = await detectProjectConfiguration({
      workspace,
      scopeRoot: root,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    const completedCandidate = {
      ...detected.draft.candidateConfig!,
      project: { id: 'user-confirmed-project' },
      evidence: { retention: { maxAgeDays: 45, minRecentSuccesses: 2 } },
    };
    const prepared = await prepareProjectConfigurationDecision({
      workspace,
      draftFile: detected.file,
      completedCandidate,
      requestId: 'project-config-request-1',
    });
    const configFile = path.join(workspace, 'repoctopus.yaml');

    await expect(access(configFile)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(prepared.request).toMatchObject({
      decisionType: 'project-configuration',
      draftId: detected.draft.draftId,
      baseConfigDigest: null,
      candidateConfig: { project: { id: 'user-confirmed-project' } },
      options: ['approve', 'request_changes', 'reject'],
    });
    expect(prepared.request.snapshotDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect((JSON.parse(await readFile(detected.file, 'utf8')) as { status: string }).status).toBe(
      'awaiting_confirmation',
    );

    await expect(
      applyProjectConfigurationDecision({
        workspace,
        decisionFile: prepared.file,
        response: response(prepared.request),
        actor: { actorId: 'agent', source: 'ide', authenticated: false },
        timestamp: '2026-01-01T00:01:00.000Z',
      }),
    ).rejects.toThrow(/not trusted/i);
    await expect(access(configFile)).rejects.toMatchObject({ code: 'ENOENT' });

    await expect(
      applyProjectConfigurationDecision({
        workspace,
        decisionFile: prepared.file,
        response: { ...response(prepared.request), snapshotDigest: 'sha256:stale' },
        actor: { actorId: 'user', source: 'cli', authenticated: true },
        timestamp: '2026-01-01T00:02:00.000Z',
      }),
    ).rejects.toThrow(/does not match/i);
    await expect(access(configFile)).rejects.toMatchObject({ code: 'ENOENT' });

    const applied = await applyProjectConfigurationDecision({
      workspace,
      decisionFile: prepared.file,
      response: response(prepared.request),
      actor: { actorId: 'user', source: 'cli', authenticated: true },
      timestamp: '2026-01-01T00:03:00.000Z',
    });
    const loaded = await loadProjectConfig(workspace);

    expect(applied).toEqual({
      status: 'confirmed',
      configFile,
      configDigest: prepared.request.candidateConfigDigest,
    });
    expect(loaded.shared).toEqual(parseSharedProjectConfig(completedCandidate));
    expect(loaded.sharedDigest).toBe(hashProjectConfig(prepared.request.candidateConfig));
    expect((JSON.parse(await readFile(detected.file, 'utf8')) as { status: string }).status).toBe(
      'confirmed',
    );
  });

  it('rejects approval when the formal config changed after the decision snapshot', async () => {
    const root = await temporaryDirectory('repoctopus-onboarding-drift-');
    cleanup.push(root);
    const workspace = await createGitRepository(root, 'workspace');
    const frontend = await createGitRepository(root, 'web-front');
    await writeFile(
      path.join(frontend, 'package.json'),
      JSON.stringify({ scripts: { build: 'vite build' } }),
    );
    const configFile = path.join(workspace, 'repoctopus.yaml');
    const initial = `apiVersion: repoctopus/v1alpha1
kind: RepoctopusProject
project: { id: existing }
repositories:
  - { id: web-front, path: ../web-front }
profiles:
  - id: verify
    nodes:
      - id: old-build
        type: command
        repository: web-front
        executable: npm
        args: [run, old-build]
`;
    await writeFile(configFile, initial);
    const detected = await detectProjectConfiguration({ workspace, scopeRoot: root });
    const prepared = await prepareProjectConfigurationDecision({
      workspace,
      draftFile: detected.file,
      completedCandidate: detected.draft.candidateConfig,
      requestId: 'project-config-request-drift',
    });
    const changed = parse(await readFile(configFile, 'utf8')) as {
      project: { id: string };
    };
    changed.project.id = 'changed-after-review';
    await writeFile(configFile, JSON.stringify(changed));

    await expect(
      applyProjectConfigurationDecision({
        workspace,
        decisionFile: prepared.file,
        response: response(prepared.request),
        actor: { actorId: 'user', source: 'ide', authenticated: true },
        timestamp: '2026-01-01T00:03:00.000Z',
      }),
    ).rejects.toThrow(/changed while awaiting confirmation/i);
    expect(
      (parse(await readFile(configFile, 'utf8')) as { project: { id: string } }).project.id,
    ).toBe('changed-after-review');
  });
});
