import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  OpenSpecProcess,
  type SpecificationProcessPort,
  type SpecificationProcessResult,
} from '../platform/specification/openspec-process.js';
import {
  OpenSpecStoreRegistration,
  OPENSPEC_ROOT_INITIALIZATION_ARGS,
} from '../platform/specification/openspec-store-registration.js';
import {
  createGitRepository,
  removeTemporaryDirectory,
  temporaryDirectory,
} from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

function userRegistryFile(): string {
  const dataRoot = process.env.XDG_DATA_HOME
    ? process.env.XDG_DATA_HOME
    : process.platform === 'win32'
      ? (process.env.LOCALAPPDATA ?? path.join(homedir(), 'AppData', 'Local'))
      : path.join(homedir(), '.local', 'share');
  return path.join(dataRoot, 'openspec', 'stores', 'registry.yaml');
}

async function optionalFileSnapshot(file: string): Promise<{
  contents: string;
  mtimeMs: number;
} | null> {
  try {
    const [contents, metadata] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
    return { contents, mtimeMs: metadata.mtimeMs };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function fixture(): Promise<{
  root: string;
  workspace: string;
  registration: OpenSpecStoreRegistration;
  process: OpenSpecProcess;
}> {
  const root = await temporaryDirectory('repoctopus-openspec-registration-');
  cleanup.push(root);
  const workspace = await createGitRepository(root, 'workspace');
  const environment = {
    XDG_DATA_HOME: path.join(root, 'xdg-data'),
    XDG_CONFIG_HOME: path.join(root, 'xdg-config'),
    OPENSPEC_TELEMETRY: '0',
    OPENSPEC_NO_UPDATE_CHECK: '1',
    OPENSPEC_NO_AUTO_CONFIG: '1',
  };
  const process = new OpenSpecProcess(undefined, 60_000, 16 * 1024 * 1024, environment);
  return { root, workspace, process, registration: new OpenSpecStoreRegistration(process) };
}

describe('OpenSpec Store registration', () => {
  it('reproduces the official missing-root failure, then initializes and registers safely', async () => {
    const { workspace, process, registration } = await fixture();
    const realRegistry = userRegistryFile();
    const realRegistryBefore = await optionalFileSnapshot(realRegistry);

    const direct = await process.execute(
      ['store', 'register', workspace, '--id', 'team-platform', '--yes', '--json'],
      { cwd: workspace },
    );
    expect(direct.exitCode).not.toBe(0);
    expect(`${direct.stdout}\n${direct.stderr}`).toMatch(
      /store_register_root_unhealthy|missing openspec\/ directory/iu,
    );

    const missing = await registration.inspect({ storeId: 'team-platform', workspace });
    expect(missing).toMatchObject({ disposition: 'missing-root', diagnosticCode: null });

    const prepared = await registration.prepareRoot({ expected: missing, allowRecovery: false });
    expect(prepared.status).toBe('initialized');
    expect(prepared.evidence.disposition).toBe('healthy-unregistered');
    const registered = await registration.ensureRegistered({ storeId: 'team-platform', workspace });
    expect(registered.status).toBe('registered');
    await expect(
      registration.inspect({ storeId: 'team-platform', workspace }),
    ).resolves.toMatchObject({
      disposition: 'registered-exact',
      registeredStoreId: 'team-platform',
      registeredRoot: workspace,
    });

    expect(await readFile(path.join(workspace, 'openspec', 'config.yaml'), 'utf8')).toContain(
      'schema: spec-driven',
    );
    expect(OPENSPEC_ROOT_INITIALIZATION_ARGS).toEqual([
      '--tools',
      'none',
      '--profile',
      'custom',
      '--language',
      'zh-CN',
      '--no-animation',
      '--no-copilot-cloud',
    ]);
    expect(await optionalFileSnapshot(realRegistry)).toEqual(realRegistryBefore);
  }, 30_000);

  it('invokes the fixed package entry with the exact approved initialization argv', async () => {
    const { workspace, process } = await fixture();
    const calls: string[][] = [];
    const recordingProcess: SpecificationProcessPort = {
      async execute(args, options): Promise<SpecificationProcessResult> {
        calls.push([...args]);
        return process.execute(args, options);
      },
    };
    const registration = new OpenSpecStoreRegistration(recordingProcess);
    const missing = await registration.inspect({ storeId: 'team-platform', workspace });
    await registration.prepareRoot({ expected: missing, allowRecovery: false });

    expect(calls).toContainEqual(['init', workspace, ...OPENSPEC_ROOT_INITIALIZATION_ARGS]);
  }, 30_000);

  it('keeps an exact healthy registration idempotent without rewriting the root', async () => {
    const { workspace, registration } = await fixture();
    const missing = await registration.inspect({ storeId: 'team-platform', workspace });
    await registration.prepareRoot({ expected: missing, allowRecovery: false });
    await registration.ensureRegistered({ storeId: 'team-platform', workspace });
    const configFile = path.join(workspace, 'openspec', 'config.yaml');
    const before = await readFile(configFile, 'utf8');
    const exact = await registration.inspect({ storeId: 'team-platform', workspace });

    await expect(
      registration.prepareRoot({ expected: exact, allowRecovery: false }),
    ).resolves.toMatchObject({ status: 'already-healthy' });
    await expect(
      registration.ensureRegistered({ storeId: 'team-platform', workspace }),
    ).resolves.toMatchObject({ status: 'already-registered' });
    expect(await readFile(configFile, 'utf8')).toBe(before);
  }, 30_000);

  it('recovers an official initializer footprint after the command result is lost', async () => {
    const { workspace, process, registration } = await fixture();
    const missing = await registration.inspect({ storeId: 'team-platform', workspace });
    const initialized = await process.execute(
      ['init', workspace, ...OPENSPEC_ROOT_INITIALIZATION_ARGS],
      { cwd: workspace },
    );
    expect(initialized.exitCode).toBe(0);

    await expect(
      registration.prepareRoot({ expected: missing, allowRecovery: true }),
    ).resolves.toMatchObject({
      status: 'recovered',
      evidence: { disposition: 'healthy-unregistered' },
    });
  }, 30_000);

  it('refuses missing-root approval after an unowned file appears', async () => {
    const { workspace, process, registration } = await fixture();
    const missing = await registration.inspect({ storeId: 'team-platform', workspace });
    await process.execute(['init', workspace, ...OPENSPEC_ROOT_INITIALIZATION_ARGS], {
      cwd: workspace,
    });
    await writeFile(path.join(workspace, 'openspec', 'user-note.md'), 'concurrent input\n');

    await expect(
      registration.prepareRoot({ expected: missing, allowRecovery: true }),
    ).rejects.toThrow(/ownership/iu);
    expect(await readFile(path.join(workspace, 'openspec', 'user-note.md'), 'utf8')).toBe(
      'concurrent input\n',
    );
  }, 30_000);

  it('blocks a pre-existing partial root without initializing or deleting it', async () => {
    const { workspace, registration } = await fixture();
    await mkdir(path.join(workspace, 'openspec'), { recursive: true });
    await writeFile(path.join(workspace, 'openspec', 'user-note.md'), 'keep me\n');

    const partial = await registration.inspect({ storeId: 'team-platform', workspace });
    expect(partial.disposition).toBe('partial-or-unhealthy');
    await expect(
      registration.prepareRoot({ expected: partial, allowRecovery: false }),
    ).rejects.toThrow(/blocked|unhealthy/iu);
    expect(await readFile(path.join(workspace, 'openspec', 'user-note.md'), 'utf8')).toBe(
      'keep me\n',
    );
  }, 30_000);

  it('does not treat a healthy nearest parent root as the Workspace root', async () => {
    const { root, workspace, process, registration } = await fixture();
    const parentInitialized = await process.execute(
      ['init', root, ...OPENSPEC_ROOT_INITIALIZATION_ARGS],
      { cwd: root },
    );
    expect(parentInitialized.exitCode).toBe(0);

    await expect(
      registration.inspect({ storeId: 'team-platform', workspace }),
    ).resolves.toMatchObject({ disposition: 'missing-root', workspaceRoot: workspace });
  }, 30_000);

  it('blocks healthy root metadata that names another Store', async () => {
    const { workspace, registration } = await fixture();
    const missing = await registration.inspect({ storeId: 'team-platform', workspace });
    await registration.prepareRoot({ expected: missing, allowRecovery: false });
    await mkdir(path.join(workspace, '.openspec-store'), { recursive: true });
    await writeFile(
      path.join(workspace, '.openspec-store', 'store.yaml'),
      'version: 1\nid: another-platform\n',
    );

    await expect(
      registration.inspect({ storeId: 'team-platform', workspace }),
    ).resolves.toMatchObject({
      disposition: 'conflicting-registration',
      diagnosticCode: 'store-metadata-id-mismatch',
    });
  }, 30_000);

  it('reports the same store id registered to another checkout as a conflict', async () => {
    const { root, workspace, registration } = await fixture();
    const missing = await registration.inspect({ storeId: 'team-platform', workspace });
    await registration.prepareRoot({ expected: missing, allowRecovery: false });
    await registration.ensureRegistered({ storeId: 'team-platform', workspace });
    const other = await createGitRepository(root, 'other-workspace');

    await expect(
      registration.inspect({ storeId: 'team-platform', workspace: other }),
    ).resolves.toMatchObject({
      disposition: 'conflicting-registration',
      registeredStoreId: 'team-platform',
      registeredRoot: workspace,
    });
  }, 30_000);

  it('rejects malformed registry output instead of guessing registration state', async () => {
    const { workspace } = await fixture();
    const process: SpecificationProcessPort = {
      execute(): Promise<SpecificationProcessResult> {
        return Promise.resolve({ exitCode: 0, stdout: '{not-json', stderr: '' });
      },
    };

    await expect(
      new OpenSpecStoreRegistration(process).inspect({ storeId: 'team-platform', workspace }),
    ).rejects.toThrow(/store list returned invalid json/iu);
  });

  it('does not accept a healthy doctor result for a parent or sibling root', async () => {
    const { root, workspace } = await fixture();
    await mkdir(path.join(workspace, 'openspec'), { recursive: true });
    await writeFile(path.join(workspace, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
    const results: SpecificationProcessResult[] = [
      { exitCode: 0, stdout: JSON.stringify({ stores: [] }), stderr: '' },
      {
        exitCode: 0,
        stdout: JSON.stringify({ root: { path: root, healthy: true }, status: [] }),
        stderr: '',
      },
    ];
    const process: SpecificationProcessPort = {
      execute(): Promise<SpecificationProcessResult> {
        const result = results.shift();
        if (!result) throw new Error('Unexpected OpenSpec process call');
        return Promise.resolve(result);
      },
    };

    await expect(
      new OpenSpecStoreRegistration(process).inspect({ storeId: 'team-platform', workspace }),
    ).resolves.toMatchObject({
      disposition: 'partial-or-unhealthy',
      diagnosticCode: 'openspec-root-unhealthy',
    });
  });
});
