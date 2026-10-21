import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { bootProjectComposition } from '../app/boot/bootstrap.js';
import {
  projectFixture,
  removeTemporaryDirectory,
  temporaryDirectory,
  workflowFixture,
} from './helpers/fixtures.js';

const productRoot = path.resolve(import.meta.dirname, '..');
const cleanup: string[] = [];

afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

async function workspaceFixture(): Promise<string> {
  const workspace = await temporaryDirectory('repoctopus-skill-run-');
  cleanup.push(workspace);
  await writeFile(
    path.join(workspace, 'repoctopus.yaml'),
    JSON.stringify({
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'RepoctopusWorkspace',
      workspace: { id: 'skill-run', repositoryId: 'workspace' },
      repositories: [{ id: 'workspace', path: '.' }],
      profiles: [
        {
          id: 'verify',
          nodes: [
            {
              id: 'noop',
              type: 'command',
              repository: 'workspace',
              executable: process.execPath,
              args: ['-e', 'process.exit(0)'],
            },
          ],
        },
      ],
    }),
  );
  return workspace;
}

async function writeSkill(workspace: string, name: string, body: string): Promise<void> {
  const directory = path.join(workspace, '.agents', 'skills', name);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} override\n---\n\n${body}\n`,
  );
}

describe('Skill snapshots bound to a Run', () => {
  it('ignores unused Skill changes and blocks a used Skill drift on resume', async () => {
    const workspace = await workspaceFixture();
    let app = await bootProjectComposition(productRoot, workspace);
    await app.context.workflowRuns.start({
      workflow: workflowFixture(),
      projectSnapshot: projectFixture({ root: workspace }),
      runId: 'skill-bound-run',
    });
    await app.context.commandRouter.execute('skill.get', {
      cwd: workspace,
      audience: 'user',
      name: 'tdd',
      runId: 'skill-bound-run',
    });
    await app.close();

    await writeSkill(workspace, 'unused-skill', 'This Skill is not used by the Run.');
    app = await bootProjectComposition(productRoot, workspace);
    const advanced = await app.context.workflowRuns.next('skill-bound-run');
    expect(advanced.value.state.status).toBe('waiting');
    expect(advanced.value.skillCompatibility?.status).toBe('same');
    await app.close();

    await writeSkill(workspace, 'tdd', 'Changed TDD method.');
    app = await bootProjectComposition(productRoot, workspace);
    const status = await app.context.workflowRuns.status('skill-bound-run');
    expect(status.skillCompatibility).toMatchObject({
      status: 'drifted',
      changedSkills: ['tdd'],
    });
    await expect(
      app.context.workflowRuns.resume({
        runId: 'skill-bound-run',
        currentProjectSnapshot: projectFixture({ root: workspace }),
      }),
    ).rejects.toThrow('requires a Human Decision or a new Run');
    await app.close();
  });
});
