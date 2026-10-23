import { createHash } from 'node:crypto';
import path from 'node:path';

import { OpenSpecProcess, type SpecificationProcessPort } from './openspec-process.js';

export interface OpenSpecStoreRegistrationPort {
  ensureRegistered(input: {
    storeId: string;
    workspace: string;
  }): Promise<{ status: 'registered' | 'already-registered'; registrationDigest: `sha256:${string}` }>;
}

interface ContextResult {
  root?: { store_id?: unknown; path?: unknown };
}

export class OpenSpecStoreRegistration implements OpenSpecStoreRegistrationPort {
  constructor(private readonly process: SpecificationProcessPort = new OpenSpecProcess()) {}

  async ensureRegistered(input: {
    storeId: string;
    workspace: string;
  }): Promise<{ status: 'registered' | 'already-registered'; registrationDigest: `sha256:${string}` }> {
    let status: 'registered' | 'already-registered' = 'already-registered';
    let context = await this.process.execute(
      ['context', '--json', '--store', input.storeId],
      { cwd: input.workspace },
    );
    if (context.exitCode !== 0) {
      const registered = await this.process.execute(
        ['store', 'register', input.workspace, '--id', input.storeId, '--yes', '--json'],
        { cwd: input.workspace },
      );
      if (registered.exitCode !== 0) {
        throw new Error(
          `OpenSpec Store registration failed: ${registered.stderr.trim() || registered.stdout.trim()}`,
        );
      }
      status = 'registered';
      context = await this.process.execute(
        ['context', '--json', '--store', input.storeId],
        { cwd: input.workspace },
      );
    }
    let parsed: ContextResult;
    try {
      parsed = JSON.parse(context.stdout) as ContextResult;
    } catch (cause) {
      throw new Error('OpenSpec Store verification returned invalid JSON', { cause });
    }
    if (
      context.exitCode !== 0 ||
      parsed.root?.store_id !== input.storeId ||
      typeof parsed.root.path !== 'string' ||
      path.resolve(parsed.root.path) !== path.resolve(input.workspace)
    ) {
      throw new Error(`OpenSpec Store ${input.storeId} is registered to a different checkout`);
    }
    return {
      status,
      registrationDigest: `sha256:${createHash('sha256')
        .update(`${input.storeId}\u0000${path.resolve(input.workspace)}`)
        .digest('hex')}`,
    };
  }
}
