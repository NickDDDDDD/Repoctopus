import { execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
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

const registration = {
  ensureRegistered: () =>
    Promise.resolve({
      status: 'registered' as const,
      registrationDigest: `sha256:${'a'.repeat(64)}` as const,
    }),
};
const execFileAsync = promisify(execFile);

function applyDecision(
  input: Parameters<typeof applyProjectConfigurationDecision>[0],
) {
  return applyProjectConfigurationDecision(input, registration);
}

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
      scanRoot: root,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    const completedCandidate = {
      ...detected.draft.candidateConfig!,
      workspace: {
        ...detected.draft.candidateConfig!.workspace,
        id: 'user-confirmed-workspace',
      },
      evidence: { retention: { maxAgeDays: 45, minRecentSuccesses: 2 } },
    };
    const prepared = await prepareProjectConfigurationDecision({
      workspace,
      draftFile: detected.file,
      completedCandidate,
      requestId: 'project-config-request-1',
    });
    const configFile = path.join(workspace, 'repoctopus.yaml');
    const frontendHead = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: frontend }))
      .stdout.trim();

    await expect(access(configFile)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(prepared.request).toMatchObject({
      decisionType: 'project-configuration',
      draftId: detected.draft.draftId,
      baseConfigDigest: null,
      candidateConfig: { workspace: { id: 'user-confirmed-workspace' } },
      options: ['approve', 'request_changes', 'reject'],
    });
    expect(prepared.request.snapshotDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect((JSON.parse(await readFile(detected.file, 'utf8')) as { status: string }).status).toBe(
      'awaiting_confirmation',
    );

    await expect(
      applyDecision({
        workspace,
        decisionFile: prepared.file,
        response: response(prepared.request),
        actor: { actorId: 'agent', source: 'ide', authenticated: false },
        timestamp: '2026-01-01T00:01:00.000Z',
      }),
    ).rejects.toThrow(/not trusted/i);
    await expect(access(configFile)).rejects.toMatchObject({ code: 'ENOENT' });

    await expect(
      applyDecision({
        workspace,
        decisionFile: prepared.file,
        response: { ...response(prepared.request), snapshotDigest: 'sha256:stale' },
        actor: { actorId: 'user', source: 'cli', authenticated: true },
        timestamp: '2026-01-01T00:02:00.000Z',
      }),
    ).rejects.toThrow(/does not match/i);
    await expect(access(configFile)).rejects.toMatchObject({ code: 'ENOENT' });

    const applied = await applyDecision({
      workspace,
      decisionFile: prepared.file,
      response: response(prepared.request),
      actor: { actorId: 'user', source: 'cli', authenticated: true },
      timestamp: '2026-01-01T00:03:00.000Z',
    });
    const loaded = await loadProjectConfig(workspace);

    expect(applied).toMatchObject({
      status: 'confirmed',
      configFile,
      configDigest: prepared.request.candidateConfigDigest,
    });
    expect(applied.bindingReceiptFiles).toHaveLength(2);
    expect(await readFile(path.join(frontend, 'openspec', 'config.yaml'), 'utf8')).toBe(
      `store: workspace\n`,
    );
    expect(
      (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: frontend })).stdout.trim(),
    ).toBe(frontendHead);
    expect((await execFileAsync('git', ['status', '--short'], { cwd: frontend })).stdout).toMatch(
      /openspec\//u,
    );
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
kind: RepoctopusWorkspace
workspace: { id: existing, repositoryId: workspace }
repositories:
  - { id: workspace, path: . }
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
    const detected = await detectProjectConfiguration({ workspace, scanRoot: root });
    const prepared = await prepareProjectConfigurationDecision({
      workspace,
      draftFile: detected.file,
      completedCandidate: detected.draft.candidateConfig,
      requestId: 'project-config-request-drift',
    });
    const changed = parse(await readFile(configFile, 'utf8')) as {
      workspace: { id: string };
    };
    changed.workspace.id = 'changed-after-review';
    await writeFile(configFile, JSON.stringify(changed));

    await expect(
      applyDecision({
        workspace,
        decisionFile: prepared.file,
        response: response(prepared.request),
        actor: { actorId: 'user', source: 'ide', authenticated: true },
        timestamp: '2026-01-01T00:03:00.000Z',
      }),
    ).rejects.toThrow(/changed while awaiting confirmation/i);
    expect(
      (parse(await readFile(configFile, 'utf8')) as { workspace: { id: string } }).workspace.id,
    ).toBe('changed-after-review');
  });

  it('recovers a pointer write after a crash and does not repeat completed actions', async () => {
    const root = await temporaryDirectory('repoctopus-onboarding-recovery-');
    cleanup.push(root);
    const workspace = await createGitRepository(root, 'workspace');
    const frontend = await createGitRepository(root, 'web-front');
    const backend = await createGitRepository(root, 'backend');
    await writeFile(
      path.join(frontend, 'package.json'),
      JSON.stringify({ scripts: { build: 'vite build' } }),
    );
    await writeFile(
      path.join(backend, 'package.json'),
      JSON.stringify({ scripts: { build: 'tsc' } }),
    );
    const detected = await detectProjectConfiguration({ workspace, scanRoot: root });
    const prepared = await prepareProjectConfigurationDecision({
      workspace,
      draftFile: detected.file,
      completedCandidate: detected.draft.candidateConfig,
      requestId: 'project-config-recovery',
    });
    let registrations = 0;
    const recoverableRegistration = {
      ensureRegistered: () => {
        registrations += 1;
        return Promise.resolve({
          status: 'registered' as const,
          registrationDigest: `sha256:${'b'.repeat(64)}` as const,
        });
      },
    };
    let interrupted = false;
    const input = {
      workspace,
      decisionFile: prepared.file,
      response: response(prepared.request),
      actor: { actorId: 'user', source: 'cli' as const, authenticated: true },
      timestamp: '2026-01-01T00:03:00.000Z',
    };
    await expect(
      applyProjectConfigurationDecision(
        {
          ...input,
          hooks: {
            afterPointerWrite: () => {
              if (!interrupted) {
                interrupted = true;
                throw new Error('simulated process interruption');
              }
            },
          },
        },
        recoverableRegistration,
      ),
    ).rejects.toThrow(/simulated process interruption/u);

    const partialPointers = await Promise.all(
      [frontend, backend].map(async (repository) => {
        try {
          return await readFile(path.join(repository, 'openspec', 'config.yaml'), 'utf8');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw error;
        }
      }),
    );
    expect(partialPointers.filter((pointer) => pointer !== null)).toHaveLength(1);

    const recovered = await applyProjectConfigurationDecision(input, recoverableRegistration);
    expect(registrations).toBe(1);
    expect(recovered.bindingReceiptFiles).toHaveLength(3);
    const pointerReceipts = await Promise.all(
      recovered.bindingReceiptFiles
        .filter((file) => file.includes('pointer-'))
        .map(async (file) => JSON.parse(await readFile(file, 'utf8')) as { result: string }),
    );
    expect(pointerReceipts.map((receipt) => receipt.result).sort()).toEqual([
      'recovered',
      'written',
    ]);
    expect(await applyProjectConfigurationDecision(input, recoverableRegistration)).toEqual(
      recovered,
    );
    expect(registrations).toBe(1);
  });

  it('rejects pointer input drift and never overwrites another Store', async () => {
    const root = await temporaryDirectory('repoctopus-onboarding-pointer-drift-');
    cleanup.push(root);
    const workspace = await createGitRepository(root, 'workspace');
    const frontend = await createGitRepository(root, 'web-front');
    await writeFile(
      path.join(frontend, 'package.json'),
      JSON.stringify({ scripts: { build: 'vite build' } }),
    );
    const detected = await detectProjectConfiguration({ workspace, scanRoot: root });
    const prepared = await prepareProjectConfigurationDecision({
      workspace,
      draftFile: detected.file,
      completedCandidate: detected.draft.candidateConfig,
      requestId: 'project-config-pointer-drift',
    });
    let interrupted = false;
    const input = {
      workspace,
      decisionFile: prepared.file,
      response: response(prepared.request),
      actor: { actorId: 'user', source: 'cli' as const, authenticated: true },
      timestamp: '2026-01-01T00:03:00.000Z',
    };
    await expect(
      applyProjectConfigurationDecision(
        {
          ...input,
          hooks: {
            afterIntent: (intent) => {
              if (intent.action === 'write-pointer' && !interrupted) {
                interrupted = true;
                throw new Error('pause before pointer write');
              }
            },
          },
        },
        registration,
      ),
    ).rejects.toThrow(/pause before pointer write/u);
    await mkdir(path.join(frontend, 'openspec'), { recursive: true });
    await writeFile(
      path.join(frontend, 'openspec', 'config.yaml'),
      'store: another-platform\n',
    );
    await expect(applyProjectConfigurationDecision(input, registration)).rejects.toThrow(
      /pointer input drifted/u,
    );
    expect(await readFile(path.join(frontend, 'openspec', 'config.yaml'), 'utf8')).toBe(
      'store: another-platform\n',
    );
  });
});
