import { execFile } from 'node:child_process';
import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { detectProjectConfiguration } from '../platform/project-configuration/detect.js';
import {
  createGitRepository,
  removeTemporaryDirectory,
  temporaryDirectory,
} from './helpers/fixtures.js';

const cleanup: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

async function status(repository: string): Promise<string> {
  return (await execFileAsync('git', ['status', '--porcelain=v2', '-z'], { cwd: repository }))
    .stdout;
}

async function expectMissing(file: string): Promise<void> {
  await expect(access(file)).rejects.toMatchObject({ code: 'ENOENT' });
}

describe('project configuration detection', () => {
  it('classifies OpenSpec Store pointer candidates without writing business repositories', async () => {
    const root = await temporaryDirectory('repoctopus-store-detect-');
    cleanup.push(root);
    const workspace = await createGitRepository(root, 'workspace');
    const unconfigured = await createGitRepository(root, 'unconfigured');
    const same = await createGitRepository(root, 'same');
    const other = await createGitRepository(root, 'other');
    const local = await createGitRepository(root, 'local');
    const damaged = await createGitRepository(root, 'damaged');
    const readOnly = await createGitRepository(root, 'read-only');
    const exit = await createGitRepository(root, 'exit');
    await writeFile(
      path.join(workspace, 'package.json'),
      JSON.stringify({ scripts: { build: 'node -e "process.exit(0)"' } }),
    );
    await mkdir(path.join(same, 'openspec'), { recursive: true });
    await writeFile(path.join(same, 'openspec', 'config.yaml'), 'store: custom-platform\n');
    await mkdir(path.join(other, 'openspec'), { recursive: true });
    await writeFile(path.join(other, 'openspec', 'config.yaml'), 'store: another-platform\n');
    await mkdir(path.join(local, 'openspec', 'specs'), { recursive: true });
    await mkdir(path.join(damaged, 'openspec'), { recursive: true });
    await writeFile(path.join(damaged, 'openspec', 'config.yaml'), 'store: [broken\n');
    await chmod(readOnly, 0o555);
    const business = [unconfigured, same, other, local, damaged, readOnly, exit];
    const before = await Promise.all(business.map(status));

    let draft: Awaited<ReturnType<typeof detectProjectConfiguration>>['draft'];
    try {
      ({ draft } = await detectProjectConfiguration({
        workspace,
        scanRoot: root,
        storeId: 'custom-platform',
        skippedPointerRepositoryIds: ['exit'],
        now: () => new Date('2026-01-01T00:00:00.000Z'),
      }));
    } finally {
      await chmod(readOnly, 0o755);
    }

    expect(draft.storeBinding).toMatchObject({
      storeId: 'custom-platform',
      workspaceRepositoryId: 'workspace',
      workspaceRoot: workspace,
    });
    expect(draft.candidateConfig?.specificationProvider).toEqual({
      id: 'specification-openspec',
      store: { id: 'custom-platform', repositoryId: 'workspace' },
    });
    const bindings = new Map(
      draft.storeBinding?.repositories.map((binding) => [binding.repositoryId, binding]),
    );
    expect(bindings.get('workspace')).toMatchObject({
      classification: 'workspace-store',
      selection: 'keep',
    });
    expect(bindings.get('unconfigured')).toMatchObject({
      classification: 'unconfigured',
      selection: 'install',
      pointerDiff: {
        path: 'openspec/config.yaml',
        before: null,
        after: 'store: custom-platform\n',
      },
    });
    expect(bindings.get('same')).toMatchObject({
      classification: 'same-store',
      selection: 'keep',
      configuredStoreId: 'custom-platform',
      pointerDiff: null,
    });
    expect(bindings.get('other')).toMatchObject({
      classification: 'other-store',
      selection: 'blocked',
      configuredStoreId: 'another-platform',
    });
    expect(bindings.get('local')).toMatchObject({
      classification: 'local-authority',
      selection: 'blocked',
    });
    expect(bindings.get('damaged')).toMatchObject({
      classification: 'damaged',
      selection: 'blocked',
    });
    expect(bindings.get('read-only')).toMatchObject({
      classification: 'read-only',
      selection: 'blocked',
    });
    expect(bindings.get('exit')).toMatchObject({
      classification: 'unconfigured',
      selection: 'skip',
      pointerDiff: null,
    });
    expect(await Promise.all(business.map(status))).toEqual(before);
    await Promise.all(
      business.map((repository) => expectMissing(path.join(repository, '.repoctopus'))),
    );
    expect(await readFile(path.join(same, 'openspec', 'config.yaml'), 'utf8')).toBe(
      'store: custom-platform\n',
    );
    expect(await readFile(path.join(other, 'openspec', 'config.yaml'), 'utf8')).toBe(
      'store: another-platform\n',
    );
  });

  it('writes sourced Node, Maven, Gradle and unresolved findings only to a workspace draft', async () => {
    const root = await temporaryDirectory('repoctopus-detect-');
    cleanup.push(root);
    const workspace = await createGitRepository(root, 'workspace');
    const frontend = await createGitRepository(root, 'web-front');
    const backend = await createGitRepository(root, 'backend');
    const worker = await createGitRepository(root, 'worker');
    const unknown = await createGitRepository(root, 'notes');
    const nested = path.join(root, 'nested');
    await mkdir(nested);
    await createGitRepository(nested, 'ignored');

    await writeFile(
      path.join(frontend, 'package.json'),
      JSON.stringify({ scripts: { dev: 'vite', typecheck: 'vue-tsc', build: 'vite build' } }),
    );
    await writeFile(path.join(frontend, 'package-lock.json'), '{}');
    await writeFile(
      path.join(frontend, 'vite.config.ts'),
      'export default { server: { port: 4173 } };\n',
    );
    await mkdir(path.join(backend, 'src', 'main', 'resources'), { recursive: true });
    await writeFile(
      path.join(backend, 'pom.xml'),
      '<project><dependency><artifactId>spring-boot-starter-web</artifactId></dependency><dependency><artifactId>spring-boot-starter-actuator</artifactId></dependency></project>',
    );
    await writeFile(
      path.join(backend, 'src', 'main', 'resources', 'application.yml'),
      'server:\n  port: 8087\n',
    );
    await writeFile(path.join(worker, 'build.gradle.kts'), 'plugins { java }\n');
    const repositories = [frontend, backend, worker, unknown];
    const before = await Promise.all(repositories.map(status));

    const { draft, file } = await detectProjectConfiguration({
      workspace,
      scanRoot: root,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(file).toMatch(
      new RegExp(
        `${path
          .join('workspace', '.repoctopus', 'drafts', 'project-detect-')
          .replaceAll('\\', '\\\\')}[0-9a-f]{24}\\.json$`,
      ),
    );
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(draft);
    expect(draft.candidateConfig?.repositories).toHaveLength(5);
    expect(draft.candidateConfig?.workspace.repositoryId).toBe('workspace');
    expect(draft.candidateConfig?.repositories.every((item) => !path.isAbsolute(item.path))).toBe(
      true,
    );
    const verifyNodes = draft.candidateConfig?.profiles.find(
      (profile) => profile.id === 'verify',
    )?.nodes;
    expect(verifyNodes?.length).toBeGreaterThan(0);
    expect(
      verifyNodes?.every((candidate) => candidate.required && candidate.covers?.[0] === '*'),
    ).toBe(true);

    const node = draft.repositories.find((item) => item.name === 'web-front');
    expect(node).toMatchObject({ technologies: ['node'] });
    expect(node?.commands.map((command) => command.id)).toEqual([
      'web-front-typecheck',
      'web-front-build',
    ]);
    expect(node?.services).toHaveLength(1);
    expect(node?.services[0]).toMatchObject({
      id: 'web-front-dev',
      port: 4173,
      confidence: 'confirmed',
    });
    expect(node?.services[0]?.sources).toContainEqual(
      expect.objectContaining({ file: 'vite.config.ts', detail: 'port 4173' }),
    );

    const spring = draft.repositories.find((item) => item.name === 'backend');
    expect(spring).toMatchObject({ technologies: ['maven'] });
    expect(spring?.services).toHaveLength(1);
    expect(spring?.services[0]).toMatchObject({
      port: 8087,
      healthEndpoint: '/actuator/health',
      confidence: 'confirmed',
    });
    expect(spring?.services[0]?.sources).toContainEqual(
      expect.objectContaining({
        file: 'src/main/resources/application.yml',
        detail: 'server port 8087',
      }),
    );
    expect(draft.repositories.find((item) => item.name === 'worker')).toMatchObject({
      technologies: ['gradle'],
      commands: [expect.objectContaining({ executable: 'gradle', args: ['build'] })],
    });
    expect(draft.unresolved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'unknown-build', repository: 'notes' }),
        expect.objectContaining({ code: 'command-review', repository: 'backend' }),
        expect.objectContaining({ code: 'command-review', repository: 'worker' }),
        expect.objectContaining({
          code: 'acceptance-coverage',
          message: expect.stringMatching(/workspace-wide.*narrow/iu),
        }),
      ]),
    );
    expect(draft.unresolved.filter((item) => item.code === 'acceptance-coverage')).toHaveLength(
      verifyNodes?.length ?? 0,
    );

    expect(await Promise.all(repositories.map(status))).toEqual(before);
    await Promise.all(
      repositories.map((repository) => expectMissing(path.join(repository, '.repoctopus'))),
    );
    await expectMissing(path.join(root, 'nested', 'ignored', '.repoctopus'));
  });

  it('reconciles with the current shared config without overwriting it or its manual fields', async () => {
    const root = await temporaryDirectory('repoctopus-reconcile-');
    cleanup.push(root);
    const workspace = await createGitRepository(root, 'workspace');
    const frontend = await createGitRepository(root, 'web-front');
    await writeFile(
      path.join(frontend, 'package.json'),
      JSON.stringify({ scripts: { build: 'vite build' } }),
    );
    const sharedFile = path.join(workspace, 'repoctopus.yaml');
    const shared = `apiVersion: repoctopus/v1alpha1
kind: RepoctopusWorkspace
workspace:
  id: hand-authored-project
  repositoryId: workspace
repositories:
  - id: workspace
    path: .
  - id: web-front
    path: ../manual-web-front
  - id: legacy
    path: ../legacy
profiles:
  - id: verify
    nodes:
      - id: manual-check
        type: command
        repository: legacy
        executable: custom-check
        args: [--strict]
evidence:
  retention:
    maxAgeDays: 99
    minRecentSuccesses: 3
delivery:
  checkpoint:
    automatic: true
    protectedBranches: [main]
    commitMessagePattern: '^feat: .+'
    quickChecks: {}
  publication:
    remote: origin
    provider: github
    githubApiBaseUrl: https://api.github.com
    mrTitleTemplate: '{{changeId}}'
    mrBodyTemplate: '{{verificationReport}}'
`;
    await writeFile(sharedFile, shared);

    const { draft } = await detectProjectConfiguration({
      workspace,
      scanRoot: root,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(await readFile(sharedFile, 'utf8')).toBe(shared);
    expect(draft.baseConfigDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(draft.reconcile).toMatchObject({
      changed: true,
      addedRepositories: [],
      removedRepositories: ['legacy'],
      addedNodes: ['verify/web-front-build'],
      removedNodes: ['verify/manual-check'],
    });
    expect(draft.reconcile?.conflicts).toEqual(
      expect.arrayContaining([
        {
          field: 'repositories.web-front.path',
          current: '../manual-web-front',
          candidate: '../web-front',
        },
        {
          field: 'workspace.id',
          current: 'hand-authored-project',
          candidate: 'workspace',
        },
      ]),
    );
    expect(draft.candidateConfig).toMatchObject({
      evidence: { retention: { maxAgeDays: 99, minRecentSuccesses: 3 } },
      delivery: {
        checkpoint: { automatic: true },
        publication: { remote: 'origin', provider: 'github' },
      },
    });
  });
});
