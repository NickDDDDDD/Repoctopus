import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { ProjectDetectionDraft } from '../../domains/project-configuration/detection.js';
import type { ProjectConfigurationDecisionRequest } from '../../domains/project-configuration/onboarding.js';
import type { SharedProjectConfig } from '../../domains/project-configuration/types.js';
import { applyProjectConfigurationDecision } from '../../platform/project-configuration/onboarding.js';
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
  it('runs detect, Agent completion, trusted confirmation and first Evidence', async () => {
    const root = await temporaryDirectory('repoctopus-onboarding-flow-');
    cleanup.push(root);
    const app = await createGitRepository(root, 'app');
    await writeFile(
      path.join(app, 'package.json'),
      JSON.stringify({ scripts: { build: 'placeholder-build' } }),
    );
    const workspace = await createGitRepository(root, 'workspace');
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
        workspace,
        '--store',
        'onboarding-store',
      ],
      environment,
    });
    const detected = detection.result as { draft: ProjectDetectionDraft; file: string };
    expect(detection).toMatchObject({ ok: true, command: 'project detect' });
    expect(detected.draft.status).toBe('candidate');
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

    await applyProjectConfigurationDecision(
      {
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
      },
      registration,
    );

    expect(await registration.inspect({ storeId: 'onboarding-store', workspace })).toMatchObject({
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
  }, 30_000);
});
