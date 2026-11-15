import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';

import {
  commitGitRepository,
  createGitRepository,
  removeTemporaryDirectory,
  temporaryDirectory,
} from '../helpers/fixtures.js';
import { runCli, type CliResult } from './cli.js';

import type { WorkSkillPreview } from '../../app/cli/skill-preview.js';

const exec = promisify(execFile);
const packageRoot =
  process.env.REPOCTOPUS_SKILL_PREVIEW_PACKAGE ?? path.resolve(import.meta.dirname, '..', '..');
const entry = path.join(packageRoot, 'bin', 'repoctopus.js');
const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(removeTemporaryDirectory)));

const binding = {
  id: 'team-api-review',
  target: 'build.check',
  role: 'guidance',
  skill: 'team-api-review',
  order: 20,
};
const config = {
  apiVersion: 'repoctopus/v1alpha1',
  kind: 'RepoctopusWorkspace',
  workspace: { id: 'skill-preview', repositoryId: 'workspace' },
  repositories: [{ id: 'workspace', path: '.' }],
  profiles: [],
  lifecycle: { skillBindings: { schemaVersion: 1, bindings: [binding] } },
};

async function workspace(input: unknown = config) {
  const root = await temporaryDirectory('repoctopus-skill-preview-');
  roots.push(root);
  const skill = path.join(root, '.agents', 'skills', 'team-api-review');
  await mkdir(path.join(skill, 'references'), { recursive: true });
  await writeFile(
    path.join(skill, 'SKILL.md'),
    '---\nname: team-api-review\ndescription: Review API compatibility.\n---\n\nPRIVATE_SKILL_TEXT\n',
  );
  await writeFile(path.join(skill, 'references', 'example.md'), 'PRIVATE_RESOURCE_TEXT\n');
  await writeFile(
    path.join(root, 'repoctopus.yaml'),
    typeof input === 'string' ? input : stringify(input),
  );
  return root;
}

async function previewFailure(cwd: string): Promise<CliResult<never>> {
  const error = await exec(process.execPath, [entry, 'skill', 'preview', '--json'], { cwd }).catch(
    (failure: unknown) => failure,
  );
  if (
    !(error instanceof Error) ||
    !('code' in error) ||
    !('stderr' in error) ||
    typeof error.stderr !== 'string'
  ) {
    throw new Error('Expected a structured CLI failure');
  }
  expect(error.code).toBe(1);
  return JSON.parse(error.stderr) as CliResult<never>;
}

describe('public skill preview', () => {
  it('shows the effective order and conditional Build variants without writing Workspace state', async () => {
    const cwd = await workspace();
    const result = await exec(process.execPath, [entry, 'skill', 'preview', '--json'], { cwd });
    const envelope = JSON.parse(result.stdout) as CliResult<WorkSkillPreview>;
    const check = envelope.result!.works.find(
      ({ kind }: { kind: string }) => kind === 'build.check',
    );
    expect(envelope).toMatchObject({
      ok: true,
      command: 'skill preview',
      runId: null,
      diagnostics: [],
    });
    expect(check!.variants[0]!.layers).toMatchObject([
      { name: 'repoctopus-build-check', position: 0, role: 'action' },
      { name: 'code-review', position: 1, role: 'builtin-augmentation', source: 'bundled' },
      {
        name: 'team-api-review',
        position: 2,
        role: 'team-guidance',
        source: 'project-agents',
        provider: 'project-user-files',
        bindingId: 'team-api-review',
      },
    ]);
    const build = envelope.result!.works.find(
      ({ kind }: { kind: string }) => kind === 'build.execute',
    );
    expect(build!.variants).toMatchObject([
      { tddMode: 'tdd', layers: [{ name: 'repoctopus-build-execute' }, { name: 'tdd' }] },
      { tddMode: 'direct', layers: [{ name: 'repoctopus-build-execute' }] },
    ]);
    expect(check!.retrySkill).toMatchObject({
      name: 'diagnosing-bugs',
      condition: 'attempt > 1',
      placement: 'after-augmentations',
      available: true,
    });
    expect(envelope.result!.works).toHaveLength(9);
    expect(result.stdout).not.toMatch(/PRIVATE_SKILL_TEXT|PRIVATE_RESOURCE_TEXT/u);
    expect(result.stdout).not.toContain(JSON.stringify(cwd).slice(1, -1));
    const human = await exec(process.execPath, [entry, 'skill', 'preview'], { cwd });
    expect(human.stdout).toMatch(/build\.check[\s\S]*team-api-review[\s\S]*project-user-files/u);
    expect(await readdir(cwd)).toEqual(['.agents', 'repoctopus.yaml']);
  });

  it.each([
    [
      'unknown Work',
      { ...binding, target: 'build.unknown' },
      /team-api-review.*unknown lifecycle Work/u,
    ],
    [
      'unknown slot',
      {
        ...binding,
        target: 'specification.plan',
        role: 'augmentation-replacement',
        slot: 'unknown-slot',
      },
      /team-api-review.*unknown augmentation slot/u,
    ],
    ['missing Skill', { ...binding, skill: 'team-missing' }, /team-missing/u],
  ])('reports %s as a failing configuration', async (_title, input, message) => {
    const cwd = await workspace({
      ...config,
      lifecycle: { skillBindings: { schemaVersion: 1, bindings: [input] } },
    });
    const error = await previewFailure(cwd);
    expect(error).toMatchObject({ ok: false, result: null });
    expect(error.diagnostics[0]?.message).toMatch(message);
    expect(await readdir(cwd)).toEqual(['.agents', 'repoctopus.yaml']);
  });

  it('identifies malformed shared YAML', async () => {
    const cwd = await workspace('lifecycle: [\n');
    const error = await previewFailure(cwd);
    expect(error).toMatchObject({ ok: false, result: null });
    expect(error.diagnostics[0]?.message).toContain('repoctopus.yaml');
  });

  it('identifies the local YAML file without printing its contents', async () => {
    const cwd = await workspace();
    await mkdir(path.join(cwd, '.repoctopus'));
    await writeFile(path.join(cwd, '.repoctopus', 'local.yaml'), 'invalid: [PRIVATE_CONFIG_TEXT\n');
    const error = await previewFailure(cwd);
    expect(error.diagnostics[0]?.message).toMatch(
      /^\.repoctopus\/local\.yaml: invalid YAML at line/u,
    );
    expect(JSON.stringify(error)).not.toContain('PRIVATE_CONFIG_TEXT');
  });

  it('reports executable team plugins without loading them', async () => {
    const cwd = await workspace({
      ...config,
      composition: {
        plugins: [{ id: 'team-plugin', descriptor: 'plugin.json', module: 'plugin.mjs' }],
      },
    });
    const error = await previewFailure(cwd);
    expect(error.diagnostics[0]?.message).toMatch(/^composition\.plugins:.*team-plugin/u);
    expect(await readdir(cwd)).toEqual(['.agents', 'repoctopus.yaml']);
  });

  it('reports an invalid project override of a conditional Build method', async () => {
    const cwd = await workspace();
    const skill = path.join(cwd, '.agents', 'skills', 'tdd');
    await mkdir(skill);
    await writeFile(
      path.join(skill, 'SKILL.md'),
      '---\nname: tdd\ndescription: Invalid project override.\nmetadata:\n  repoctopus:\n    artifactProtocolOwner: true\n---\n\nOverride.\n',
    );
    const error = await previewFailure(cwd);
    expect(error.diagnostics[0]?.message).toMatch(/action owner: tdd/u);
  });

  it('executes the generated tutorial and matches the configured Open layers delivered in a real Run', async () => {
    const root = await temporaryDirectory('repoctopus-skill-guide-');
    roots.push(root);
    const origin = path.join(root, 'origin.git');
    await exec('git', ['init', '--bare', '--initial-branch=main', origin]);
    const cwd = await createGitRepository(root, 'workspace', origin);
    const environment = {
      XDG_DATA_HOME: path.join(root, 'xdg-data'),
      XDG_CONFIG_HOME: path.join(root, 'xdg-config'),
      REPOCTOPUS_DESKTOP_OTLP_MODE: 'removed',
    };
    const cli = <T = unknown>(...args: string[]) =>
      runCli<T>({ packageRoot, args, cwd, environment });
    type Prepared = {
      file: string;
      request: { apiVersion: string; requestId: string; snapshotDigest: string };
    };
    async function approve({ file, request: { apiVersion, requestId, snapshotDigest } }: Prepared) {
      const decision = path.join(root, 'decision.json');
      await writeFile(
        decision,
        JSON.stringify({
          apiVersion,
          requestId,
          snapshotDigest,
          kind: 'HumanDecisionResponse',
          decision: 'approve',
        }),
      );
      await cli('project', 'review', '--request', file, '--response-file', decision);
    }
    const init = await cli<Prepared>(
      'project',
      'init',
      '--layout',
      'single',
      '--entry-hosts',
      'codearts',
    );
    await approve(init.result!);
    const guidePath = path.join(cwd, 'docs/repoctopus/workspace-guide.md');
    const guide = await readFile(guidePath, 'utf8');
    await writeFile(
      guidePath,
      '# Team guide\n\n<repoctopus-guide>\nPrevious guide.\n</repoctopus-guide>\n',
    );
    const detected = await cli<{ file: string }>(
      'project',
      'detect',
      '--layout',
      'single',
      '--scan-root',
      '.',
      '--entry-hosts',
      'codearts',
    );
    const prepared = await cli<Prepared>(
      'project',
      'prepare',
      '--draft',
      detected.result!.file,
      '--candidate',
      'repoctopus.yaml',
    );
    await approve(prepared.result!);
    expect(await readFile(guidePath, 'utf8')).toBe('# Team guide\n\n' + guide);
    const example = guide.split('## 在工作流中接入团队 Skill')[1]!.split('## 刷新已有')[0]!;
    const skill = example.match(/```markdown\n([\s\S]+?)```/u)![1]!;
    const yaml = example.match(/```yaml\n([\s\S]+?)```/u)![1]!;
    expect(example).toContain('repoctopus.cmd skill preview --workspace .');
    const skillDirectory = path.join(cwd, '.agents', 'skills', 'team-api-review');
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(path.join(skillDirectory, 'SKILL.md'), skill);
    const actualConfig = path.join(cwd, 'repoctopus.yaml');
    const generated = parse(await readFile(actualConfig, 'utf8')) as Record<string, unknown>;
    const tutorial = parse(yaml) as typeof config;
    await writeFile(
      actualConfig,
      stringify({
        ...generated,
        lifecycle: {
          skillBindings: {
            schemaVersion: 1,
            bindings: [
              ...tutorial.lifecycle.skillBindings.bindings,
              { ...binding, id: 'team-open-api', target: 'change.intake' },
            ],
          },
        },
      }),
    );
    const before = await readdir(path.join(cwd, '.repoctopus'));
    const preview = await cli<{
      works: { kind: string; variants: { layers: Array<{ name: string; role: string }> }[] }[];
    }>('skill', 'preview', '--workspace', '.');
    expect(await readdir(path.join(cwd, '.repoctopus'))).toEqual(before);
    const layers = (kind: string) =>
      preview
        .result!.works.find((work) => work.kind === kind)!
        .variants[0]!.layers.map(({ name, role }) => ({ name, role }));
    expect(layers('build.check').at(-1)).toEqual({
      name: 'team-api-review',
      role: 'team-guidance',
    });

    await commitGitRepository(cwd, 'configure workspace and team skill');
    await exec('git', ['push', '-u', 'origin', 'main'], { cwd });
    await exec('git', ['switch', '-c', 'change/test-team-skill-preview'], { cwd });
    await exec('git', ['push', '-u', 'origin', 'HEAD'], { cwd });
    const { runId } = await cli(
      'run',
      'start',
      '--change',
      'test-team-skill-preview',
      '--target',
      'main',
    );
    const view = await cli<{
      entryRunner: string;
      changeLifecycle: {
        currentWork: { kind: string; capabilities: string[] };
      };
    }>('run', 'status', '--run', runId!);
    const {
      entryRunner,
      changeLifecycle: { currentWork },
    } = view.result!;
    expect(currentWork.kind).toBe('change.intake');
    const claim = await cli<{
      packet: { context: { layers: Array<{ source: string; skillRole?: string }> } };
    }>(
      'run',
      'work-claim',
      '--run',
      runId!,
      '--runner',
      entryRunner,
      '--adapter',
      'manual',
      '--attempt',
      '1',
      '--host-capabilities',
      currentWork.capabilities.join(','),
    );
    expect(
      claim
        .result!.packet.context.layers.filter((layer) => layer.skillRole)
        .map(({ source, skillRole }) => ({ name: source, role: skillRole })),
    ).toEqual(layers('change.intake'));
    const beforePreview = await cli('run', 'status', '--run', runId!);
    const activePreview = await cli('skill', 'preview');
    expect(activePreview.result).toEqual(preview.result);
    expect(await cli('run', 'status', '--run', runId!)).toEqual(beforePreview);
  }, 60_000);
});
