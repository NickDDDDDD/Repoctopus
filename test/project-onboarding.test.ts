import { execFile } from 'node:child_process';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { parse } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import {
  hashProjectConfig,
  parseSharedProjectConfig,
} from '../domains/project-configuration/config.js';
import type { ProjectDetectionDraft } from '../domains/project-configuration/detection.js';
import { createStoreBindingIntent } from '../domains/project-configuration/store-binding.js';
import {
  createProjectConfigurationDecision,
  type ProjectConfigurationDecisionResponse,
} from '../domains/project-configuration/onboarding.js';
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
import { OpenSpecProcess } from '../platform/specification/openspec-process.js';
import {
  OpenSpecStoreRegistration,
  type OpenSpecStoreRegistrationPort,
} from '../platform/specification/openspec-store-registration.js';

const registration: OpenSpecStoreRegistrationPort = {
  inspect: ({ storeId, workspace }) =>
    Promise.resolve({
      disposition: 'registered-exact',
      workspaceRoot: workspace,
      storeId,
      registeredStoreId: storeId,
      registeredRoot: workspace,
      rootManifestDigest: null,
      diagnosticCode: null,
      providerVersion: '1.14.3',
      digest: `sha256:${'a'.repeat(64)}`,
    }),
  prepareRoot: ({
    expected,
  }: {
    expected: NonNullable<ProjectDetectionDraft['storeBinding']>['root'];
  }) =>
    Promise.resolve({
      status:
        expected.disposition === 'missing-root'
          ? ('initialized' as const)
          : ('already-healthy' as const),
      evidence: expected,
      evidenceDigest: expected.digest,
    }),
  ensureRegistered: () =>
    Promise.resolve({
      status: 'registered' as const,
      registrationDigest: `sha256:${'a'.repeat(64)}` as const,
    }),
};
const execFileAsync = promisify(execFile);

function applyDecision(input: Parameters<typeof applyProjectConfigurationDecision>[0]) {
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

async function guideDecisionFixture() {
  const root = await temporaryDirectory('repoctopus-guide-transaction-');
  cleanup.push(root);
  const workspace = await createGitRepository(root, 'workspace');
  const web = await createGitRepository(root, 'web');
  await writeFile(
    path.join(web, 'package.json'),
    JSON.stringify({ scripts: { build: 'node --version' } }),
  );
  const detected = await detectProjectConfiguration({ workspace, scanRoot: root });
  const prepared = await prepareProjectConfigurationDecision({
    workspace,
    draftFile: detected.file,
    completedCandidate: detected.draft.candidateConfig!,
  });
  return {
    workspace,
    web,
    prepared,
    input: {
      workspace,
      decisionFile: prepared.file,
      response: response(prepared.request),
      actor: { actorId: 'user', source: 'cli' as const, authenticated: true },
      timestamp: '2026-01-01T00:00:00.000Z',
    },
  };
}

describe('project configuration onboarding', () => {
  it('previews the managed Workspace entry and installs it only on approval', async () => {
    const { workspace, prepared, input } = await guideDecisionFixture();
    const entry = path.join(workspace, '.agents/skills/repoctopus/SKILL.md');
    expect(prepared.request).toMatchObject({
      entrySkills: [
        { host: 'codex', path: '.agents/skills/repoctopus/SKILL.md', status: 'create' },
        { host: 'opencode', path: '.opencode/skills/repoctopus/SKILL.md', status: 'create' },
      ],
    });
    await expect(access(entry)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(applyDecision(input)).resolves.toMatchObject({ status: 'confirmed' });
    expect(await readFile(entry, 'utf8')).toContain('name: repoctopus');
  });

  it('keeps an unmanaged or edited entry and binds the approved paths to the snapshot', async () => {
    const { workspace, input } = await guideDecisionFixture();
    const entry = path.join(workspace, '.agents/skills/repoctopus/SKILL.md');
    await mkdir(path.dirname(entry), { recursive: true });
    const original = '# Team-owned skill\n';
    await writeFile(entry, original);
    await expect(applyDecision(input)).rejects.toThrow(/unmanaged or locally modified/);
    expect(await readFile(entry, 'utf8')).toBe(original);
    await expect(access(path.join(workspace, 'repoctopus.yaml'))).rejects.toMatchObject({
      code: 'ENOENT',
    });

    const decision = JSON.parse(await readFile(input.decisionFile, 'utf8')) as {
      request: { entrySkills: [{ path: string }] };
    };
    decision.request.entrySkills[0].path = 'README.md';
    await writeFile(input.decisionFile, JSON.stringify(decision));
    await expect(applyDecision(input)).rejects.toThrow(/no longer matches its snapshot/);
  });

  it('resumes between host installations and leaves completed targets and business repositories alone', async () => {
    const { workspace, web, prepared, input } = await guideDecisionFixture();
    const codex = path.join(workspace, '.agents/skills/repoctopus/SKILL.md');
    const opencode = path.join(workspace, '.opencode/skills/repoctopus/SKILL.md');
    await expect(
      applyDecision({
        ...input,
        hooks: {
          afterEntryWrite: () => {
            throw new Error('entry installation interrupted');
          },
        },
      }),
    ).rejects.toThrow('entry installation interrupted');
    const firstWrite = await stat(codex);
    await expect(access(opencode)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(path.join(workspace, 'repoctopus.yaml'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const resumed = await applyDecision(input);
    expect(resumed.status).toBe('confirmed');
    expect(await readFile(opencode, 'utf8')).toBe(await readFile(codex, 'utf8'));
    expect((await stat(codex)).mtimeMs).toBe(firstWrite.mtimeMs);
    await expect(access(path.join(web, '.agents'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(path.join(web, '.opencode'))).rejects.toMatchObject({ code: 'ENOENT' });

    const localEdit = '# Keep this change to the installed entry';
    await writeFile(codex, localEdit);
    await expect(applyDecision(input)).resolves.toEqual(resumed);
    expect(await readFile(codex, 'utf8')).toBe(localEdit);
    const detected = await detectProjectConfiguration({
      workspace,
      scanRoot: path.dirname(workspace),
      specificationAuthority: registration,
    });
    expect(detected.draft.entrySkills?.map(({ status }) => status)).toEqual(['conflict', 'keep']);
    expect(prepared.request.entrySkills).toHaveLength(2);
  });

  it('installs only the chosen host in a single-repository Workspace', async () => {
    const root = await temporaryDirectory('repoctopus-single-entry-');
    cleanup.push(root);
    const workspace = await createGitRepository(root, 'workspace');
    await writeFile(
      path.join(workspace, 'package.json'),
      JSON.stringify({ scripts: { build: 'node --version' } }),
    );
    const detected = await detectProjectConfiguration({
      workspace,
      scanRoot: root,
      entryHosts: ['opencode'],
      specificationAuthority: registration,
    });
    expect(detected.draft.entrySkills?.map(({ host }) => host)).toEqual(['opencode']);
    const prepared = await prepareProjectConfigurationDecision({
      workspace,
      draftFile: detected.file,
      completedCandidate: detected.draft.candidateConfig!,
    });
    await applyDecision({
      workspace,
      decisionFile: prepared.file,
      response: response(prepared.request),
      actor: { actorId: 'user', source: 'cli', authenticated: true },
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    await expect(access(path.join(workspace, '.agents'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(
      await readFile(path.join(workspace, '.opencode/skills/repoctopus/SKILL.md'), 'utf8'),
    ).toContain('name: repoctopus');
  });

  it.each(['reject', 'request_changes'] as const)(
    'does not install guides before approval or after %s',
    async (decision) => {
      const { workspace, input } = await guideDecisionFixture();
      const readme = await readFile(path.join(workspace, 'README.md'));
      await expect(access(path.join(workspace, 'AGENTS.md'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      const result = await applyDecision({ ...input, response: { ...input.response, decision } });
      expect(result.status).toBe(decision === 'reject' ? 'rejected' : 'request_changes');
      expect(await readFile(path.join(workspace, 'README.md'))).toEqual(readme);
      await expect(access(path.join(workspace, 'docs'))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(path.join(workspace, 'repoctopus.yaml'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );

  it('preflights malformed guides before Store side effects or config publication', async () => {
    const { workspace, input } = await guideDecisionFixture();
    await writeFile(path.join(workspace, 'AGENTS.md'), '<repoctopus-workflow>\nBroken');
    let sideEffects = 0;
    await expect(
      applyProjectConfigurationDecision(input, {
        ...registration,
        prepareRoot: (request) => {
          sideEffects++;
          return registration.prepareRoot(request);
        },
        ensureRegistered: (request) => {
          sideEffects++;
          return registration.ensureRegistered(request);
        },
      }),
    ).rejects.toThrow(/managed block/u);
    expect(sideEffects).toBe(0);
    await expect(access(path.join(workspace, 'repoctopus.yaml'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('resumes a partially installed guide set before publishing configuration, and keeps confirmed replay inert', async () => {
    const { workspace, prepared, input } = await guideDecisionFixture();
    await expect(
      applyDecision({
        ...input,
        hooks: {
          afterGuideWrite(file: string) {
            if (file === 'README.md') throw new Error('simulated guide interruption');
          },
        },
      }),
    ).rejects.toThrow('simulated guide interruption');
    const readme = await readFile(path.join(workspace, 'README.md'));
    const readmeStat = await stat(path.join(workspace, 'README.md'));
    expect(JSON.parse(await readFile(prepared.file, 'utf8'))).toMatchObject({ status: 'applying' });
    await expect(access(path.join(workspace, 'repoctopus.yaml'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const completed = await applyDecision(input);
    expect(completed.status).toBe('confirmed');
    expect(await readFile(path.join(workspace, 'README.md'))).toEqual(readme);
    expect((await stat(path.join(workspace, 'README.md'))).mtimeMs).toBe(readmeStat.mtimeMs);
    await writeFile(path.join(workspace, 'AGENTS.md'), '# Later team change\n');
    expect(await applyDecision(input)).toEqual(completed);
    expect(await readFile(path.join(workspace, 'AGENTS.md'), 'utf8')).toBe('# Later team change\n');
  });

  it('requires a usable default verify profile before creating an approval request', async () => {
    const root = await temporaryDirectory('repoctopus-onboarding-coverage-');
    cleanup.push(root);
    const workspace = await createGitRepository(root, 'workspace');
    const frontend = await createGitRepository(root, 'web-front');
    await writeFile(
      path.join(frontend, 'package.json'),
      JSON.stringify({ scripts: { build: 'vite build' } }),
    );
    const detected = await detectProjectConfiguration({ workspace, scanRoot: root });
    const candidate = detected.draft.candidateConfig!;
    const detectedNode = candidate.profiles.find((profile) => profile.id === 'verify')!.nodes[0]!;
    const decide = (completedCandidate: unknown) =>
      createProjectConfigurationDecision({
        draft: detected.draft,
        completedCandidate,
        currentConfig: null,
        requestId: 'coverage-readiness',
      });

    expect(() =>
      decide({
        ...candidate,
        profiles: [
          {
            id: 'independent-diagnostics',
            nodes: [{ ...detectedNode, id: 'diagnostics', required: false, covers: [] }],
          },
        ],
      }),
    ).toThrow(/default verify.*required coverage/iu);
    expect(() =>
      decide({
        ...candidate,
        profiles: candidate.profiles.map((profile) => ({
          ...profile,
          nodes: profile.nodes.map((node) => ({ ...node, covers: [] })),
        })),
      }),
    ).toThrow(/default verify.*required coverage/iu);
    expect(() =>
      decide({
        ...candidate,
        profiles: [
          {
            id: 'verify',
            nodes: [{ ...detectedNode, required: false, covers: ['*'] }],
          },
        ],
      }),
    ).toThrow(/default verify.*required coverage/iu);

    const request = decide({
      ...candidate,
      profiles: [
        {
          id: 'verify',
          nodes: [
            { ...detectedNode, id: 'prepare', required: true, covers: [] },
            {
              ...detectedNode,
              id: 'acceptance-gate',
              dependsOn: ['prepare'],
              required: true,
              covers: ['*'],
            },
          ],
        },
        {
          id: 'independent-diagnostics',
          nodes: [{ ...detectedNode, id: 'diagnostics', required: false, covers: [] }],
        },
      ],
    });
    expect(
      request.candidateConfig.profiles.find((profile) => profile.id === 'verify'),
    ).toBeDefined();

    expect(() =>
      createProjectConfigurationDecision({
        draft: {
          ...detected.draft,
          storeBinding: detected.draft.storeBinding
            ? {
                ...detected.draft.storeBinding,
                root: {
                  ...detected.draft.storeBinding.root,
                  disposition: 'partial-or-unhealthy',
                  diagnosticCode: 'openspec-root-unhealthy',
                },
              }
            : null,
        },
        completedCandidate: candidate,
        currentConfig: null,
      }),
    ).toThrow(/root blocks.*unhealthy/iu);
  });

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
      telemetry: { endpoint: 'https://collector.example/otel' },
    };
    const prepared = await prepareProjectConfigurationDecision({
      workspace,
      draftFile: detected.file,
      completedCandidate,
      requestId: 'project-config-request-1',
    });
    const configFile = path.join(workspace, 'repoctopus.yaml');
    const frontendHead = (
      await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: frontend })
    ).stdout.trim();

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
    expect(applied.bindingReceiptFiles).toHaveLength(3);
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
    const guide = await readFile(
      path.join(workspace, 'docs/repoctopus/workspace-guide.md'),
      'utf8',
    );
    expect(await readFile(path.join(workspace, 'README.md'), 'utf8')).toContain(
      '(docs/repoctopus/workspace-guide.md)',
    );
    expect(await readFile(path.join(workspace, 'AGENTS.md'), 'utf8')).toContain('run next');
    expect(guide).toContain('web-front');
    expect(guide).toContain('telemetry.endpoint');
    expect(guide).not.toContain(workspace);
    expect(guide).not.toContain('https://collector.example/otel');
    expect(hashProjectConfig(loaded.shared)).toBe(prepared.request.candidateConfigDigest);
    expect(loaded.sharedDigest).not.toBe(prepared.request.candidateConfigDigest);
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
      ...registration,
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
    expect(recovered.bindingReceiptFiles).toHaveLength(4);
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

  it('recovers the same approved transaction when initialization landed before its Receipt', async () => {
    const root = await temporaryDirectory('repoctopus-onboarding-root-recovery-');
    cleanup.push(root);
    const workspace = await createGitRepository(root, 'workspace');
    const frontend = await createGitRepository(root, 'web-front');
    await writeFile(
      path.join(frontend, 'package.json'),
      JSON.stringify({ scripts: { build: 'vite build' } }),
    );
    const environment = {
      XDG_DATA_HOME: path.join(root, 'xdg-data'),
      XDG_CONFIG_HOME: path.join(root, 'xdg-config'),
      OPENSPEC_TELEMETRY: '0',
      OPENSPEC_NO_UPDATE_CHECK: '1',
      OPENSPEC_NO_AUTO_CONFIG: '1',
    };
    const authority = new OpenSpecStoreRegistration(
      new OpenSpecProcess(undefined, 60_000, 16 * 1024 * 1024, environment),
    );
    const detected = await detectProjectConfiguration({
      workspace,
      scanRoot: root,
      storeId: 'root-recovery',
      specificationAuthority: authority,
    });
    const prepared = await prepareProjectConfigurationDecision({
      workspace,
      draftFile: detected.file,
      completedCandidate: detected.draft.candidateConfig,
      requestId: 'root-recovery-request',
    });
    const input = {
      workspace,
      decisionFile: prepared.file,
      response: response(prepared.request),
      actor: { actorId: 'user', source: 'cli' as const, authenticated: true },
      timestamp: '2026-01-01T00:03:00.000Z',
    };
    let interrupted = false;
    const interruptedAuthority: OpenSpecStoreRegistrationPort = {
      inspect: (request) => authority.inspect(request),
      ensureRegistered: (request) => authority.ensureRegistered(request),
      prepareRoot: async (request) => {
        const result = await authority.prepareRoot(request);
        if (!interrupted) {
          interrupted = true;
          throw new Error('simulated lost initializer result');
        }
        return result;
      },
    };

    await expect(applyProjectConfigurationDecision(input, interruptedAuthority)).rejects.toThrow(
      /lost initializer result/u,
    );
    expect(await readFile(path.join(workspace, 'openspec', 'config.yaml'), 'utf8')).toContain(
      'schema: spec-driven',
    );
    await expect(access(path.join(workspace, 'repoctopus.yaml'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(access(path.join(frontend, 'openspec', 'config.yaml'))).rejects.toMatchObject({
      code: 'ENOENT',
    });

    const recovered = await applyProjectConfigurationDecision(input, authority);
    expect(recovered.bindingReceiptFiles).toHaveLength(3);
    expect(
      JSON.parse(
        await readFile(
          path.join(
            workspace,
            '.repoctopus',
            'onboarding',
            'store-bindings',
            prepared.request.requestId,
            'prepare-root.receipt.json',
          ),
          'utf8',
        ),
      ),
    ).toMatchObject({ result: 'recovered' });
    expect(await authority.inspect({ storeId: 'root-recovery', workspace })).toMatchObject({
      disposition: 'registered-exact',
    });
  }, 30_000);

  it('continues a matching historical register Intent after adding root preparation', async () => {
    const root = await temporaryDirectory('repoctopus-onboarding-register-intent-');
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
      requestId: 'existing-register-intent',
    });
    const proposal = prepared.request.storeBinding!;
    const journal = path.join(
      workspace,
      '.repoctopus',
      'onboarding',
      'store-bindings',
      prepared.request.requestId,
    );
    await mkdir(journal, { recursive: true });
    await writeFile(
      path.join(journal, 'register-store.intent.json'),
      `${JSON.stringify(
        createStoreBindingIntent({
          actionId: 'register-store',
          requestId: prepared.request.requestId,
          action: 'register-store',
          storeId: proposal.storeId,
          repositoryId: proposal.workspaceRepositoryId,
        }),
        null,
        2,
      )}\n`,
    );

    const applied = await applyDecision({
      workspace,
      decisionFile: prepared.file,
      response: response(prepared.request),
      actor: { actorId: 'user', source: 'cli', authenticated: true },
      timestamp: '2026-01-01T00:03:00.000Z',
    });
    expect(applied.bindingReceiptFiles.map((file) => path.basename(file))).toEqual([
      'prepare-root.receipt.json',
      'register-store.receipt.json',
      'pointer-web-front.receipt.json',
    ]);
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
    await writeFile(path.join(frontend, 'openspec', 'config.yaml'), 'store: another-platform\n');
    await expect(applyProjectConfigurationDecision(input, registration)).rejects.toThrow(
      /pointer input drifted/u,
    );
    expect(await readFile(path.join(frontend, 'openspec', 'config.yaml'), 'utf8')).toBe(
      'store: another-platform\n',
    );
  });
});
