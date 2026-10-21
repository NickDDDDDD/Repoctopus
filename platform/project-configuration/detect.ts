import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  DetectedCommand,
  DetectedRepository,
  DetectedService,
  DetectionSource,
  DetectionUnresolvedItem,
  ProjectDetectionDraft,
} from '../../domains/project-configuration/detection.js';
import { hashProjectConfig } from '../../domains/project-configuration/config.js';
import { reconcileProjectConfig } from '../../domains/project-configuration/reconcile.js';
import type { SharedProjectConfig } from '../../domains/project-configuration/types.js';
import { canonicalJson } from '../../domains/workflow-contract/canonical.js';
import { atomicWriteJson } from '../filesystem/atomic-write.js';
import { probeProject } from '../git/probe.js';
import { loadProjectConfig } from './file-config.js';

const MAX_DETECTION_FILE_BYTES = 1024 * 1024;

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '') || 'repository'
  );
}

async function optionalText(file: string): Promise<string | null> {
  try {
    const before = await lstat(file, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_DETECTION_FILE_BYTES) {
      return null;
    }
    const contents = await readFile(file, 'utf8');
    const after = await lstat(file, { bigint: true });
    if (
      before.ino !== after.ino ||
      before.ctimeNs !== after.ctimeNs ||
      before.size !== after.size
    ) {
      throw new Error(`Detection input changed while reading: ${file}`);
    }
    return contents;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function source(repositoryId: string, file: string, detail: string): DetectionSource {
  return { repositoryId, file: file.replaceAll('\\', '/'), detail };
}

function nodePackageManager(files: { npm: boolean; pnpm: boolean; yarn: boolean }): {
  executable: string;
  argsFor: (script: string) => string[];
  source: string;
} {
  if (files.pnpm) {
    return { executable: 'pnpm', argsFor: (script) => ['run', script], source: 'pnpm-lock.yaml' };
  }
  if (files.yarn) {
    return { executable: 'yarn', argsFor: (script) => [script], source: 'yarn.lock' };
  }
  return { executable: 'npm', argsFor: (script) => ['run', script], source: 'package.json' };
}

function detectedPort(
  sources: Array<{ file: string; contents: string | null }>,
): { port: number; file: string } | null {
  for (const { file, contents } of sources) {
    if (!contents) continue;
    const match = /(?:--port(?:=|\s+)|\bport\s*[:=]\s*)(\d{2,5})/iu.exec(contents);
    const port = match ? Number(match[1]) : 0;
    if (port >= 1 && port <= 65_535) return { port, file };
  }
  return null;
}

function springPort(
  sources: Array<{ file: string; contents: string | null }>,
): { port: number; file: string } | null {
  for (const { file, contents } of sources) {
    if (!contents) continue;
    const match = /(?:^|\n)\s*server(?:\.port\s*=|:\s*(?:\r?\n\s+)?port:\s*)(\d{2,5})/iu.exec(
      contents,
    );
    const port = match ? Number(match[1]) : 0;
    if (port >= 1 && port <= 65_535) return { port, file };
  }
  return null;
}

async function inspectDetectedRepository(input: {
  id: string;
  name: string;
  absolutePath: string;
  configuredPath: string;
  remoteIdentity: string | null;
}): Promise<{ repository: DetectedRepository; unresolved: DetectionUnresolvedItem[] }> {
  const read = (file: string) => optionalText(path.join(input.absolutePath, file));
  const [
    packageJson,
    packageLock,
    pnpmLock,
    yarnLock,
    viteTs,
    viteJs,
    pom,
    gradle,
    gradleKts,
    appYaml,
    appYml,
    appProperties,
  ] = await Promise.all([
    read('package.json'),
    read('package-lock.json'),
    read('pnpm-lock.yaml'),
    read('yarn.lock'),
    read('vite.config.ts'),
    read('vite.config.js'),
    read('pom.xml'),
    read('build.gradle'),
    read('build.gradle.kts'),
    read('src/main/resources/application.yaml'),
    read('src/main/resources/application.yml'),
    read('src/main/resources/application.properties'),
  ]);
  const technologies: DetectedRepository['technologies'] = [];
  const commands: DetectedCommand[] = [];
  const services: DetectedService[] = [];
  const unresolved: DetectionUnresolvedItem[] = [];

  if (packageJson) {
    technologies.push('node');
    const parsed = JSON.parse(packageJson) as { scripts?: Record<string, unknown> };
    const scripts = parsed.scripts ?? {};
    const manager = nodePackageManager({
      npm: packageLock !== null,
      pnpm: pnpmLock !== null,
      yarn: yarnLock !== null,
    });
    for (const script of ['typecheck', 'lint', 'test', 'build']) {
      if (typeof scripts[script] !== 'string') continue;
      commands.push({
        id: `${input.id}-${script}`,
        repository: input.id,
        executable: manager.executable,
        args: manager.argsFor(script),
        cwd: '.',
        confidence: 'confirmed',
        sources: [source(input.id, 'package.json', `scripts.${script}`)],
        ...(script === 'test' ? { zeroTests: 'warning' as const } : {}),
      });
    }
    const devScript = typeof scripts.dev === 'string' ? scripts.dev : null;
    if (devScript) {
      const detected = detectedPort([
        { file: 'package.json', contents: devScript },
        { file: 'vite.config.ts', contents: viteTs },
        { file: 'vite.config.js', contents: viteJs },
      ]);
      services.push({
        id: `${input.id}-dev`,
        repository: input.id,
        ...(detected ? { port: detected.port } : {}),
        confidence: detected ? 'confirmed' : 'inferred',
        sources: [
          source(input.id, 'package.json', 'scripts.dev'),
          ...(detected ? [source(input.id, detected.file, `port ${detected.port}`)] : []),
        ],
      });
      if (!detected) {
        unresolved.push({
          code: 'service-port',
          repository: input.id,
          message: 'Development service port needs confirmation',
          source: source(input.id, 'package.json', 'scripts.dev'),
        });
      }
    }
  }

  if (pom) {
    technologies.push('maven');
    commands.push({
      id: `${input.id}-verify`,
      repository: input.id,
      executable: 'mvn',
      args: ['verify'],
      cwd: '.',
      confidence: 'inferred',
      sources: [source(input.id, 'pom.xml', 'Maven project')],
      zeroTests: 'warning',
    });
    const detected = springPort([
      { file: 'src/main/resources/application.yaml', contents: appYaml },
      { file: 'src/main/resources/application.yml', contents: appYml },
      { file: 'src/main/resources/application.properties', contents: appProperties },
    ]);
    const actuator = /spring-boot-starter-actuator/u.test(pom);
    if (/spring-boot/u.test(pom)) {
      services.push({
        id: `${input.id}-service`,
        repository: input.id,
        ...(detected ? { port: detected.port } : {}),
        ...(actuator ? { healthEndpoint: '/actuator/health' } : {}),
        confidence: detected && actuator ? 'confirmed' : 'inferred',
        sources: [
          source(input.id, 'pom.xml', 'Spring Boot dependencies'),
          ...(detected ? [source(input.id, detected.file, `server port ${detected.port}`)] : []),
        ],
      });
      if (!detected) {
        unresolved.push({
          code: 'service-port',
          repository: input.id,
          message: 'Spring service port needs confirmation',
          source: source(input.id, 'pom.xml', 'Spring Boot project'),
        });
      }
      if (!actuator) {
        unresolved.push({
          code: 'health-endpoint',
          repository: input.id,
          message: 'Spring health endpoint needs confirmation',
          source: source(input.id, 'pom.xml', 'No actuator dependency detected'),
        });
      }
    }
  }

  if (gradle || gradleKts) {
    technologies.push('gradle');
    commands.push({
      id: `${input.id}-build`,
      repository: input.id,
      executable: 'gradle',
      args: ['build'],
      cwd: '.',
      confidence: 'inferred',
      sources: [source(input.id, gradle ? 'build.gradle' : 'build.gradle.kts', 'Gradle project')],
      zeroTests: 'warning',
    });
  }

  if (technologies.length === 0) {
    unresolved.push({
      code: 'unknown-build',
      repository: input.id,
      message: 'No supported Node, Maven or Gradle build file was detected',
    });
  }
  for (const command of commands.filter((item) => item.confidence === 'inferred')) {
    const commandSource = command.sources[0];
    unresolved.push({
      code: 'command-review',
      repository: input.id,
      message: `Confirm inferred command: ${command.executable} ${command.args.join(' ')}`,
      ...(commandSource ? { source: commandSource } : {}),
    });
  }
  return {
    repository: {
      id: input.id,
      name: input.name,
      path: input.configuredPath,
      remoteIdentity: input.remoteIdentity,
      technologies,
      commands,
      services,
    },
    unresolved,
  };
}

async function optionalExistingConfig(workspace: string): Promise<SharedProjectConfig | null> {
  try {
    return (await loadProjectConfig(workspace)).shared;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function detectProjectConfiguration(input: {
  workspace: string;
  scopeRoot: string;
  now?: () => Date;
}): Promise<{ draft: ProjectDetectionDraft; file: string }> {
  const workspace = path.resolve(input.workspace);
  const scopeRoot = path.resolve(input.scopeRoot);
  const snapshot = await probeProject({
    root: scopeRoot,
    duplicateIdentity: 'omit-ambiguous',
    ...(input.now ? { now: input.now } : {}),
  });
  const ids = new Map<string, number>();
  const inspected = await Promise.all(
    snapshot.repositories.map(async (repository) => {
      const base = slug(repository.name);
      const count = (ids.get(base) ?? 0) + 1;
      ids.set(base, count);
      const id = count === 1 ? base : `${base}-${count}`;
      return inspectDetectedRepository({
        id,
        name: repository.name,
        absolutePath: repository.path,
        configuredPath: path.relative(workspace, repository.path).replaceAll('\\', '/') || '.',
        remoteIdentity: repository.remoteIdentity,
      });
    }),
  );
  const repositories = inspected.map((item) => item.repository);
  const unresolved = inspected.flatMap((item) => item.unresolved);
  const commandNodes = repositories.flatMap((repository) =>
    repository.commands.map((command) => ({
      id: command.id,
      type: 'command' as const,
      repository: command.repository,
      dependsOn: [],
      required: true,
      executable: command.executable,
      args: command.args,
      cwd: command.cwd,
      timeoutMs: 10 * 60_000,
      cache: false,
      ...(command.zeroTests ? { zeroTests: command.zeroTests } : {}),
    })),
  );
  const current = await optionalExistingConfig(workspace);
  const workspaceRepository = repositories.find((repository) => repository.path === '.');
  const detectedCandidate: SharedProjectConfig | null =
    workspaceRepository && commandNodes.length > 0
      ? {
          apiVersion: 'repoctopus/v1alpha1',
          kind: 'RepoctopusWorkspace',
          workspace: {
            id: slug(path.basename(workspace)),
            repositoryId: workspaceRepository.id,
          },
          repositories: repositories.map((repository) => ({
            id: repository.id,
            path: repository.path,
          })),
          profiles: [{ id: 'verify', nodes: commandNodes }],
        }
      : null;
  const candidateConfig: SharedProjectConfig | null = detectedCandidate
    ? {
        ...detectedCandidate,
        ...(current?.evidence ? { evidence: structuredClone(current.evidence) } : {}),
        ...(current?.delivery ? { delivery: structuredClone(current.delivery) } : {}),
      }
    : null;
  const baseConfigDigest = current ? hashProjectConfig(current) : null;
  const reconcile =
    current && candidateConfig ? reconcileProjectConfig(current, candidateConfig) : null;
  const capturedAt = (input.now ?? (() => new Date()))().toISOString();
  const content = { repositories, unresolved, candidateConfig, baseConfigDigest, reconcile };
  const draftId = createHash('sha256').update(canonicalJson(content)).digest('hex').slice(0, 24);
  const draft: ProjectDetectionDraft = {
    apiVersion: 'repoctopus/v1alpha1',
    kind: 'ProjectDetectionDraft',
    draftId,
    status: 'candidate',
    capturedAt,
    scopeRoot,
    workspace,
    ...content,
  };
  const file = path.join(workspace, '.repoctopus', 'drafts', `project-detect-${draftId}.json`);
  await atomicWriteJson(file, draft);
  return { draft, file };
}
