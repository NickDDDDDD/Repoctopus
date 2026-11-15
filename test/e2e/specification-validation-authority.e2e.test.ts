import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, expect, it } from 'vitest';

import type { SpecificationValidation } from '../../domains/specification/types.js';
import { FileRuntimeStore } from '../../platform/runtime/file-runtime-store.js';
import {
  commitGitRepository,
  createGitRepository,
  removeTemporaryDirectory,
  temporaryDirectory,
} from '../helpers/fixtures.js';
import { runCli, type CliResult } from './cli.js';

const exec = promisify(execFile);
const packageRoot =
  process.env.REPOCTOPUS_VALIDATION_TEST_PACKAGE ?? path.resolve(import.meta.dirname, '../..');
const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(removeTemporaryDirectory)));

it('strictly validates changing drafts without writing any Run and rejects a different Change', async () => {
  const root = await temporaryDirectory('repoctopus-validation-authority-');
  roots.push(root);
  const remote = path.join(root, 'origin.git');
  await exec('git', ['init', '--bare', '--initial-branch=main', remote]);
  const cwd = await createGitRepository(root, 'workspace', remote);
  const environment = {
    XDG_DATA_HOME: path.join(root, 'xdg-data'),
    XDG_CONFIG_HOME: path.join(root, 'xdg-config'),
    REPOCTOPUS_DESKTOP_OTLP_MODE: 'removed',
    OPENSPEC_NO_UPDATE_CHECK: '1',
    OPENSPEC_TELEMETRY: '0',
  };
  const git = (...args: string[]) => exec('git', args, { cwd });
  const cli = <T = unknown>(...args: string[]) =>
    runCli<T>({ packageRoot, args, cwd, environment });
  type Prepared = {
    file: string;
    request: { apiVersion: string; requestId: string; snapshotDigest: string };
  };
  const init = await cli<Prepared>(
    'project',
    'init',
    '--layout',
    'single',
    '--entry-hosts',
    'codex',
  );
  const responseFile = path.join(root, 'approval.json');
  const { apiVersion, requestId, snapshotDigest } = init.result!.request;
  await writeFile(
    responseFile,
    JSON.stringify({
      apiVersion,
      requestId,
      snapshotDigest,
      kind: 'HumanDecisionResponse',
      decision: 'approve',
    }),
  );
  await cli('project', 'review', '--request', init.result!.file, '--response-file', responseFile);
  await commitGitRepository(cwd, 'configure isolated workspace');
  await git('push', '-u', 'origin', 'main');

  const change = 'validation-authority';
  await git('switch', '-c', 'change/' + change);
  await git('push', '-u', 'origin', 'HEAD');
  const { runId } = await cli('run', 'start', '--change', change, '--target', 'main');
  const store = path.join(cwd, '.repoctopus', 'runs', runId!);
  const persisted = () =>
    Promise.all(
      ['run.json', 'checkpoint.json', 'trajectory.jsonl'].map((name) =>
        readFile(path.join(store, name), 'utf8'),
      ),
    );
  const original = await persisted();

  async function draft(id: string, purpose?: string) {
    const directory = path.join(cwd, 'openspec', 'changes', id);
    await mkdir(path.join(directory, 'specs', id), { recursive: true });
    await writeFile(
      path.join(directory, 'proposal.md'),
      '# Proposal\n\n## Why\n\nExercise Run-scoped validation.\n\n## What Changes\n\n- Add one diagnostic marker.\n\n## Capabilities\n\n### New Capabilities\n\n- ' +
        id +
        '\n\n## Impact\n\nOnly the test fixture.\n',
    );
    await writeFile(path.join(directory, 'design.md'), '# Design\n\nUse one marker file.\n');
    await writeFile(
      path.join(directory, 'tasks.md'),
      '# Tasks\n\n## 1. Marker\n\n- [ ] 1.1 Add a marker.\n  **Acceptance:** The marker exists.\n  **Requirements:** ' +
        id +
        '#marker-is-present\n',
    );
    await writeFile(
      path.join(directory, 'specs', id, 'spec.md'),
      '# Marker\n\n' +
        (purpose ? '## Purpose\n\n' + purpose + '\n\n' : '') +
        '## ADDED Requirements\n\n### Requirement: Marker is present\nThe fixture MUST contain a marker.\n\n#### Scenario: Read marker\n- **WHEN** the marker is read\n- **THEN** it contains the named value\n',
    );
  }

  async function failedValidation(id: string) {
    try {
      return await cli('spec', 'validate', '--change', id, '--run', runId!);
    } catch (error) {
      const failure = error as { code: number; stderr: string };
      expect(failure.code).toBe(1);
      return JSON.parse(failure.stderr) as CliResult;
    }
  }

  await draft(change);
  const invalid = await failedValidation(change);
  expect(invalid.ok).toBe(false);
  expect.soft(invalid.diagnostics.map((d) => d.message).join('\n')).toContain('requires Purpose');
  expect.soft(await persisted()).toEqual(original);

  await draft(change, 'Describe the diagnostic marker for this isolated workspace.');
  const valid = await cli<SpecificationValidation>(
    'spec',
    'validate',
    '--change',
    change,
    '--run',
    runId!,
  );
  expect(valid.result?.valid).toBe(true);
  await draft(change, 'Describe the revised diagnostic marker for the current platform.');
  const revised = await cli<SpecificationValidation>(
    'spec',
    'validate',
    '--change',
    change,
    '--run',
    runId!,
  );
  expect(revised.result?.valid).toBe(true);
  expect(revised.result?.validationDigest).not.toBe(valid.result?.validationDigest);

  await draft('unrelated-change', 'Describe a marker owned by a different Change.');
  const mismatch = await failedValidation('unrelated-change');
  expect(mismatch.ok).toBe(false);
  expect(mismatch.diagnostics[0]?.code).toBe('specification.run-change-mismatch');
  expect(await persisted()).toEqual(original);

  const crashingStore = new FileRuntimeStore(cwd, {
    afterJournalWritten: () => {
      throw new Error('interrupted after journal');
    },
  });
  const beforeCrash = await crashingStore.inspect(runId!);
  const pendingState = { ...beforeCrash.state!, stateVersion: beforeCrash.state!.stateVersion + 1 };
  await expect(
    crashingStore.commit({
      state: pendingState,
      previousStateVersion: beforeCrash.state!.stateVersion,
      event: {
        ...beforeCrash.trajectory.at(-1)!,
        eventId: 'specification-validation-pending-commit',
        sequence: beforeCrash.trajectory.length + 1,
        stateVersion: pendingState.stateVersion,
        type: 'run.resumed',
      },
    }),
  ).rejects.toThrow('interrupted after journal');
  const journalFile = path.join(store, 'transition.json');
  const journal = await readFile(journalFile, 'utf8');
  await cli('spec', 'validate', '--change', change, '--run', runId!);
  expect(await readFile(journalFile, 'utf8')).toBe(journal);
  expect(await persisted()).toEqual(original);
}, 90_000);
