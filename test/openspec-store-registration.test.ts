import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type {
  SpecificationProcessPort,
  SpecificationProcessResult,
} from '../platform/specification/openspec-process.js';
import { OpenSpecStoreRegistration } from '../platform/specification/openspec-store-registration.js';

class FakeProcess implements SpecificationProcessPort {
  readonly calls: string[][] = [];

  constructor(
    private readonly workspace: string,
    private readonly initiallyRegistered: boolean,
  ) {}

  execute(args: readonly string[]): Promise<SpecificationProcessResult> {
    this.calls.push([...args]);
    const contextCalls = this.calls.filter((call) => call[0] === 'context').length;
    if (args[0] === 'context' && (!this.initiallyRegistered && contextCalls === 1)) {
      return Promise.resolve({ exitCode: 1, stdout: '{}', stderr: 'unknown store' });
    }
    if (args[0] === 'store' && args[1] === 'register') {
      return Promise.resolve({ exitCode: 0, stdout: '{"ok":true}', stderr: '' });
    }
    return Promise.resolve({
      exitCode: 0,
      stdout: JSON.stringify({ root: { store_id: 'team-platform', path: this.workspace } }),
      stderr: '',
    });
  }
}

describe('OpenSpec Store registration', () => {
  it('uses idempotent register and verification commands without destructive removal', async () => {
    const workspace = path.resolve('fixture-workspace');
    const process = new FakeProcess(workspace, false);
    const result = await new OpenSpecStoreRegistration(process).ensureRegistered({
      storeId: 'team-platform',
      workspace,
    });

    expect(result.status).toBe('registered');
    expect(process.calls).toEqual([
      ['context', '--json', '--store', 'team-platform'],
      ['store', 'register', workspace, '--id', 'team-platform', '--yes', '--json'],
      ['context', '--json', '--store', 'team-platform'],
    ]);
    expect(process.calls.flat()).not.toContain('remove');
    expect(process.calls.flat()).not.toContain('unregister');
  });

  it('does not register again when the exact checkout is already registered', async () => {
    const workspace = path.resolve('fixture-workspace');
    const process = new FakeProcess(workspace, true);
    const result = await new OpenSpecStoreRegistration(process).ensureRegistered({
      storeId: 'team-platform',
      workspace,
    });
    expect(result.status).toBe('already-registered');
    expect(process.calls).toEqual([['context', '--json', '--store', 'team-platform']]);
  });
});
