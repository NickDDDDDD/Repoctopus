import {
  access,
  copyFile,
  mkdir,
  readFile,
  realpath,
  rename,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import { parseSharedProjectConfig } from '../../domains/project-configuration/config.js';
import type { ProjectDetectionDraft } from '../../domains/project-configuration/detection.js';
import type { ProjectConfigurationDecisionRequest } from '../../domains/project-configuration/onboarding.js';
import type { SharedProjectConfig } from '../../domains/project-configuration/types.js';
import {
  applyProjectConfigurationDecision,
  prepareProjectConfigurationDecision,
} from '../../platform/project-configuration/onboarding.js';
import { OpenSpecProcess } from '../../platform/specification/openspec-process.js';
import { OpenSpecStoreRegistration } from '../../platform/specification/openspec-store-registration.js';
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
  it('plans selected personal and Workspace Skills for the additional hosts', async () => {
    const root = await temporaryDirectory('repoctopus additional hosts ');
    cleanup.push(root);
    const workspace = await createGitRepository(root, 'workspace');
    const userDirectory = path.join(root, 'host profile');
    await mkdir(userDirectory);
    const environment = {
      HOME: userDirectory,
      USERPROFILE: userDirectory,
      CODEX_HOME: path.join(userDirectory, '.codex'),
      CODEBUDDY_CONFIG_DIR: '',
      XDG_CONFIG_HOME: path.join(userDirectory, '.config'),
      XDG_DATA_HOME: path.join(root, 'xdg'),
      OPENSPEC_TELEMETRY: '0',
      OPENSPEC_NO_UPDATE_CHECK: '1',
    };
    const hosts = 'codebuddy,codearts,trae,trae-cn';
    const preview = await runCli<{ targets: Array<{ path: string }> }>({
      packageRoot,
      cwd: workspace,
      environment,
      args: ['skill', 'install-init', '--entry-hosts', hosts, '--preview'],
    });
    const personalTargets = ['.codebuddy', '.codeartsdoer', '.trae', '.trae-cn'].map((directory) =>
      path.join(userDirectory, directory, 'skills', 'repoctopus-init', 'SKILL.md'),
    );
    expect(preview.result?.targets.map(({ path }) => path)).toEqual(personalTargets);
    for (const file of personalTargets) {
      await expect(access(file)).rejects.toMatchObject({ code: 'ENOENT' });
    }
    await runCli({
      packageRoot,
      cwd: workspace,
      environment,
      args: ['skill', 'install-init', '--entry-hosts', hosts],
    });
    for (const file of personalTargets) {
      expect(await readFile(file, 'utf8')).toContain('name: repoctopus-init');
    }
    await expect(access(path.join(userDirectory, '.codex'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const init = await runCli<{ request: ProjectConfigurationDecisionRequest }>({
      packageRoot,
      cwd: workspace,
      environment,
      args: ['project', 'init', '--layout', 'single', '--entry-hosts', hosts],
    });
    expect(init.result?.request.entrySkills?.map(({ path }) => path)).toEqual(
      ['.codebuddy', '.codeartsdoer', '.trae'].flatMap((directory) =>
        ['repoctopus', 'repoctopus-configure-verify'].map(
          (skill) => `${directory}/skills/${skill}/SKILL.md`,
        ),
      ),
    );
  });

  it('installs only selected Workspace Skills through a separate approval', async () => {
    const root = await temporaryDirectory('repoctopus approved skill install ');
    cleanup.push(root);
    const workspace = await createGitRepository(root, 'workspace');
    const backend = await createGitRepository(root, 'backend');
    const configFile = path.join(workspace, 'repoctopus.yaml');
    const config = JSON.stringify({
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'RepoctopusWorkspace',
      workspace: { id: 'installed', repositoryId: 'workspace' },
      repositories: [
        { id: 'workspace', path: '.' },
        { id: 'backend', path: '../backend' },
      ],
      profiles: [],
    });
    await writeFile(configFile, config);
    const environment = {
      XDG_CONFIG_HOME: path.join(root, 'config'),
      XDG_DATA_HOME: path.join(root, 'data'),
      OPENSPEC_TELEMETRY: '0',
    };
    const invoke = <T>(...args: string[]) =>
      runCli<T>({ packageRoot, cwd: workspace, args, environment });
    const prepare = () =>
      invoke<{ file: string; request: ProjectConfigurationDecisionRequest }>(
        'project',
        'install-entry-skills',
        '--entry-hosts',
        'codearts',
      );
    const file = path.join(workspace, '.codeartsdoer/skills/repoctopus/SKILL.md');
    const responseFile = path.join(root, 'decision.json');
    for (const decision of ['reject', 'approve'] as const) {
      const { result } = await prepare();
      const request = result!.request;
      expect(request.storeBinding).toBeNull();
      expect(request.baseConfigDigest).toBe(request.candidateConfigDigest);
      expect(request.entrySkills?.map(({ host }) => host)).toEqual(['codearts', 'codearts']);
      await expect(access(file)).rejects.toMatchObject({ code: 'ENOENT' });
      await writeFile(
        responseFile,
        JSON.stringify({
          apiVersion: request.apiVersion,
          kind: 'HumanDecisionResponse',
          requestId: request.requestId,
          snapshotDigest: request.snapshotDigest,
          decision,
        }),
      );
      await invoke('project', 'review', '--request', result!.file, '--response-file', responseFile);
    }
    expect(await readFile(file, 'utf8')).toContain('name: repoctopus');
    expect(await readFile(configFile, 'utf8')).toBe(config);
    expect(await readFile(path.join(workspace, 'README.md'), 'utf8')).toBe('# workspace\n');
    for (const untouched of [
      path.join(workspace, 'AGENTS.md'),
      path.join(workspace, 'openspec'),
      path.join(workspace, '.agents'),
      path.join(backend, '.codeartsdoer'),
      path.join(backend, 'openspec'),
    ]) {
      await expect(access(untouched)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it('installs only the explicitly selected personal Init entry and previews Verify setup for the Workspace', async () => {
    const root = await temporaryDirectory('repoctopus personal init ');
    cleanup.push(root);
    const workspace = await createGitRepository(root, 'workspace');
    const home = path.join(root, 'host-home');
    await mkdir(home);
    const environment = {
      HOME: home,
      USERPROFILE: home,
      CODEX_HOME: path.join(home, '.codex'),
      XDG_DATA_HOME: path.join(root, 'xdg-data'),
      XDG_CONFIG_HOME: path.join(home, '.config'),
      OPENSPEC_TELEMETRY: '0',
      OPENSPEC_NO_UPDATE_CHECK: '1',
      OPENSPEC_NO_AUTO_CONFIG: '1',
    };
    const invoke = <T>(...args: string[]) =>
      runCli<T>({ packageRoot, cwd: workspace, args, environment });
    await invoke('skill', 'install-init', '--entry-hosts', 'codex');
    const personal = path.join(home, '.codex/skills/repoctopus-init/SKILL.md');
    expect(await readFile(personal, 'utf8')).toContain('name: repoctopus-init');
    await expect(
      access(path.join(home, '.config/opencode/skills/repoctopus-init/SKILL.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    const prepared = await invoke<{ file: string; request: ProjectConfigurationDecisionRequest }>(
      'project',
      'init',
      '--layout',
      'single',
      '--entry-hosts',
      'codex',
      '--store',
      'install-entry-test',
    );
    const { request, file } = prepared.result!;
    const relative = '.agents/skills/repoctopus-configure-verify/SKILL.md';
    expect(request.entrySkills?.map(({ path }) => path)).toContain(relative);
    await expect(access(path.join(workspace, relative))).rejects.toMatchObject({ code: 'ENOENT' });
    const responseFile = path.join(root, 'accept.json');
    await writeFile(
      responseFile,
      JSON.stringify({
        apiVersion: request.apiVersion,
        kind: 'HumanDecisionResponse',
        requestId: request.requestId,
        snapshotDigest: request.snapshotDigest,
        decision: 'approve',
      }),
    );
    await invoke('project', 'review', '--request', file, '--response-file', responseFile);
    expect(await readFile(path.join(workspace, relative), 'utf8')).toContain(
      'name: repoctopus-configure-verify',
    );
    expect(await readFile(path.join(workspace, 'repoctopus.yaml'), 'utf8')).toContain(
      'profiles: []',
    );

    const profileFile = path.join(root, 'verify-profile.json');
    const candidate = {
      id: 'verify',
      nodes: [
        {
          id: 'runtime-version',
          type: 'command',
          repository: 'workspace',
          required: true,
          covers: ['*'],
          dependsOn: [],
          executable: 'node',
          args: ['--version'],
          cwd: '.',
          timeoutMs: 5000,
          cache: false,
        },
      ],
    };
    await writeFile(profileFile, JSON.stringify(candidate));
    const configured = await invoke<{ file: string; request: ProjectConfigurationDecisionRequest }>(
      'project',
      'configure-verify',
      '--candidate',
      profileFile,
    );
    const configFile = path.join(workspace, 'repoctopus.yaml');
    const before = parseSharedProjectConfig(parse(await readFile(configFile, 'utf8')));
    expect(before.profiles).toEqual([]);
    expect(configured.result?.request.candidateConfig).toEqual({
      ...before,
      profiles: [candidate],
    });
    const profileRequest = configured.result!.request;
    await writeFile(
      responseFile,
      JSON.stringify({
        apiVersion: profileRequest.apiVersion,
        kind: 'HumanDecisionResponse',
        requestId: profileRequest.requestId,
        snapshotDigest: profileRequest.snapshotDigest,
        decision: 'approve',
      }),
    );
    await invoke(
      'project',
      'review',
      '--request',
      configured.result!.file,
      '--response-file',
      responseFile,
    );
    expect(parseSharedProjectConfig(parse(await readFile(configFile, 'utf8')))).toEqual({
      ...before,
      profiles: [candidate],
    });
  });
  it('prepares and rejects the same minimal Init request through the public Host CLI', async () => {
    const root = await temporaryDirectory('repoctopus init host ');
    cleanup.push(root);
    const workspace = await createGitRepository(root, 'workspace');
    await createGitRepository(root, 'unrelated');
    const environment = {
      XDG_DATA_HOME: path.join(root, 'xdg-data'),
      XDG_CONFIG_HOME: path.join(root, 'xdg-config'),
      OPENSPEC_TELEMETRY: '0',
      OPENSPEC_NO_UPDATE_CHECK: '1',
      OPENSPEC_NO_AUTO_CONFIG: '1',
    };
    const invoke = <T>(...args: string[]) =>
      runCli<T>({ packageRoot, cwd: workspace, args, environment });
    const prepared = await invoke<{ file: string; request: ProjectConfigurationDecisionRequest }>(
      'project',
      'init',
      '--layout',
      'single',
      '--store',
      'init-host-test',
    );
    expect(prepared.result?.request.candidateConfig).toMatchObject({
      profiles: [],
      repositories: [{ id: 'workspace', path: '.' }],
    });
    const { file, request } = prepared.result!;
    await expect(access(path.join(workspace, 'repoctopus.yaml'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const observed = await invoke<ProjectConfigurationDecisionRequest>(
      'project',
      'decision',
      '--request',
      file,
    );
    expect(observed.result?.snapshotDigest).toBe(request.snapshotDigest);
    const response = path.join(root, 'response.json');
    await writeFile(
      response,
      JSON.stringify({
        apiVersion: request.apiVersion,
        kind: 'HumanDecisionResponse',
        requestId: request.requestId,
        snapshotDigest: request.snapshotDigest,
        decision: 'reject',
      }),
    );
    const result = await invoke(
      'project',
      'review',
      '--request',
      file,
      '--response-file',
      response,
    );
    expect(result.result).toMatchObject({ status: 'rejected' });
    await expect(access(path.join(workspace, 'repoctopus.yaml'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(access(path.join(workspace, 'openspec'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
  it('runs detect, Agent completion, trusted confirmation and first Evidence', async () => {
    const root = await temporaryDirectory('repoctopus-onboarding-flow-');
    cleanup.push(root);
    const app = await createGitRepository(root, 'app');
    await writeFile(
      path.join(app, 'package.json'),
      JSON.stringify({ scripts: { build: 'placeholder-build' } }),
    );
    const workspace = await realpath(await createGitRepository(root, 'workspace'));
    const workspaceAlias = path.join(root, 'workspace-alias');
    await symlink(workspace, workspaceAlias, process.platform === 'win32' ? 'junction' : 'dir');
    const environment = {
      XDG_DATA_HOME: path.join(root, 'xdg-data'),
      XDG_CONFIG_HOME: path.join(root, 'xdg-config'),
      OPENSPEC_TELEMETRY: '0',
      OPENSPEC_NO_UPDATE_CHECK: '1',
      OPENSPEC_NO_AUTO_CONFIG: '1',
    };
    const openspecProcess = new OpenSpecProcess(undefined, 60_000, 16 * 1024 * 1024, environment);
    const registration = new OpenSpecStoreRegistration(openspecProcess);

    const detection = await runCli({
      packageRoot,
      cwd: workspace,
      args: [
        'project',
        'detect',
        '--scan-root',
        root,
        '--workspace',
        workspaceAlias,
        '--store',
        'onboarding-store',
      ],
      environment,
    });
    const detected = detection.result as { draft: ProjectDetectionDraft; file: string };
    expect(detection).toMatchObject({ ok: true, command: 'project detect' });
    expect(detected.draft.status).toBe('candidate');
    expect(detected.draft.workspace).toBe(workspace);
    expect(detected.draft.candidateConfig?.repositories).toEqual([
      { id: 'app', path: '../app' },
      { id: 'workspace', path: '.' },
    ]);
    expect(detected.draft.storeBinding).toMatchObject({
      storeId: 'onboarding-store',
      workspaceRepositoryId: 'workspace',
    });
    expect(detected.draft.unresolved).toContainEqual(
      expect.objectContaining({ code: 'acceptance-coverage', repository: 'app' }),
    );
    expect(
      detected.draft.candidateConfig?.profiles
        .flatMap((profile) => profile.nodes)
        .find((node) => node.repository === 'app'),
    ).toMatchObject({ required: true, covers: ['*'] });
    expect(
      detected.draft.storeBinding?.repositories.find(
        (repository) => repository.repositoryId === 'app',
      ),
    ).toMatchObject({
      repositoryId: 'app',
      classification: 'unconfigured',
      selection: 'install',
    });

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
              covers: ['*'],
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
    const externalDecisions = path.join(root, 'external-decisions');
    const localDecisions = path.join(workspace, '.repoctopus', 'decisions');
    await mkdir(externalDecisions);
    await symlink(
      externalDecisions,
      localDecisions,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(
      prepareProjectConfigurationDecision({
        workspace: workspaceAlias,
        draftFile: detected.file,
        completedCandidate: candidate,
        requestId: 'escaped-decision',
      }),
    ).rejects.toThrow(/Atomic write parent must be a real directory/u);
    await expect(
      access(path.join(externalDecisions, 'project-configuration-escaped-decision.json')),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await rename(localDecisions, path.join(root, 'external-decisions-alias'));
    const preparedEnvelope = await runCli({
      packageRoot,
      cwd: workspace,
      args: [
        'project',
        'prepare',
        '--workspace',
        workspaceAlias,
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

    const approval = {
      workspace: workspaceAlias,
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
    } as const;

    const drafts = path.join(workspace, '.repoctopus', 'drafts');
    const externalDrafts = path.join(root, 'external-drafts');
    const savedDrafts = path.join(workspace, '.repoctopus', 'saved-drafts');
    await mkdir(externalDrafts);
    await copyFile(detected.file, path.join(externalDrafts, path.basename(detected.file)));
    await rename(drafts, savedDrafts);
    await symlink(externalDrafts, drafts, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(applyProjectConfigurationDecision(approval, registration)).rejects.toThrow(
      /Resolved file is outside .repoctopus\/drafts/u,
    );
    await expect(access(path.join(workspace, 'repoctopus.yaml'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await rename(drafts, path.join(root, 'external-drafts-alias'));
    await rename(savedDrafts, drafts);
    await expect(
      applyProjectConfigurationDecision(
        {
          ...approval,
          hooks: {
            afterIntent(intent) {
              if (intent.action === 'write-pointer') throw new Error('interrupted before pointer');
            },
          },
        },
        registration,
      ),
    ).rejects.toThrow('interrupted before pointer');
    const registry = path.join(environment.XDG_DATA_HOME, 'openspec', 'stores', 'registry.yaml');
    const registryBefore = await readFile(registry, 'utf8');
    await writeFile(
      registry,
      JSON.stringify({
        version: 1,
        stores: { 'onboarding-store': { backend: { type: 'git', local_path: app } } },
      }),
    );
    await expect(applyProjectConfigurationDecision(approval, registration)).rejects.toThrow(
      /Store registration changed after approval/u,
    );
    await expect(access(path.join(app, 'openspec', 'config.yaml'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await writeFile(registry, registryBefore);
    await applyProjectConfigurationDecision(approval, registration);

    const registered = await registration.inspect({ storeId: 'onboarding-store', workspace });
    expect(
      await registration.inspect({ storeId: 'onboarding-store', workspace: workspaceAlias }),
    ).toEqual(registered);
    expect(registered).toMatchObject({
      disposition: 'registered-exact',
      registeredRoot: workspace,
    });
    expect(await readFile(path.join(workspace, 'openspec', 'config.yaml'), 'utf8')).toContain(
      'schema: spec-driven',
    );
    expect(await readFile(path.join(app, 'openspec', 'config.yaml'), 'utf8')).toBe(
      'store: onboarding-store\n',
    );
    const pointerContext = await openspecProcess.execute(['context', '--json'], { cwd: app });
    expect(pointerContext.exitCode).toBe(0);
    expect(JSON.parse(pointerContext.stdout)).toMatchObject({
      root: { store_id: 'onboarding-store', path: workspace },
    });

    const created = await openspecProcess.execute(
      [
        'new',
        'change',
        'onboarding-smoke',
        '--schema',
        'spec-driven',
        '--store',
        'onboarding-store',
        '--json',
      ],
      { cwd: app },
    );
    expect(created.exitCode).toBe(0);
    const changeRoot = path.join(workspace, 'openspec', 'changes', 'onboarding-smoke');
    await mkdir(path.join(changeRoot, 'specs', 'onboarding-smoke'), { recursive: true });
    await Promise.all([
      writeFile(
        path.join(changeRoot, 'proposal.md'),
        '# Proposal\n\n## Why\n\n验证首次接入。\n\n## What Changes\n\n- 增加接入验证。\n\n## Capabilities\n\n### New Capabilities\n\n- `onboarding-smoke`: 验证接入。\n\n### Modified Capabilities\n\n无。\n\n## Impact\n\n- 仅测试临时仓。\n',
      ),
      writeFile(
        path.join(changeRoot, 'design.md'),
        '# Design\n\n## Context\n\n临时验收。\n\n## Goals / Non-Goals\n\n- 验证 Store。\n\n## Decisions\n\n- 使用正式 Store。\n\n## Risks\n\n- 无持久影响。\n',
      ),
      writeFile(
        path.join(changeRoot, 'tasks.md'),
        '# Tasks\n\n- [ ] 1.1 验证接入\n  **Acceptance:** 严格校验通过。\n',
      ),
      writeFile(
        path.join(changeRoot, 'specs', 'onboarding-smoke', 'spec.md'),
        '## ADDED Requirements\n\n### Requirement: 接入可消费\n\n系统 MUST 消费登记后的 Store。\n\n#### Scenario: 严格校验\n\n- **WHEN** 创建临时 Change\n- **THEN** OpenSpec 严格校验成功\n',
      ),
    ]);
    const validated = await openspecProcess.execute(
      ['validate', 'onboarding-smoke', '--strict', '--json', '--store', 'onboarding-store'],
      { cwd: app },
    );
    expect(validated.exitCode, validated.stderr || validated.stdout).toBe(0);
    const coldProcess = new OpenSpecProcess(undefined, 60_000, 16 * 1024 * 1024, environment);
    const coldContext = await coldProcess.execute(
      ['context', '--json', '--store', 'onboarding-store'],
      { cwd: workspace },
    );
    expect(coldContext.exitCode).toBe(0);

    const evidence = await runCli({
      packageRoot,
      cwd: workspace,
      args: ['evidence', 'run', '--workspace', workspace, '--profile', 'verify'],
      environment,
    });
    expect(evidence).toMatchObject({
      protocolVersion: 1,
      ok: true,
      command: 'evidence run',
      result: { bundle: { outcome: 'passed' } },
    });

    const otherCheckout = await createGitRepository(root, 'other-checkout');
    const decisions = path.join(otherCheckout, '.repoctopus', 'decisions');
    await mkdir(decisions, { recursive: true });
    await copyFile(prepared.file, path.join(decisions, path.basename(prepared.file)));
    await rename(workspaceAlias, path.join(root, 'original-workspace-alias'));
    await symlink(otherCheckout, workspaceAlias, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(
      applyProjectConfigurationDecision(
        {
          ...approval,
          decisionFile: path.join(
            workspaceAlias,
            '.repoctopus',
            'decisions',
            path.basename(prepared.file),
          ),
        },
        registration,
      ),
    ).rejects.toThrow(/belongs to another Workspace checkout/u);
    await expect(access(path.join(otherCheckout, 'repoctopus.yaml'))).rejects.toMatchObject({
      code: 'ENOENT',
    });

    await rename(workspace, path.join(root, 'moved-workspace'));
    expect(
      await registration.inspect({ storeId: 'onboarding-store', workspace: workspaceAlias }),
    ).toMatchObject({
      disposition: 'conflicting-registration',
      diagnosticCode: 'store-registration-conflict',
      registeredRoot: workspace,
    });
  }, 30_000);
});
