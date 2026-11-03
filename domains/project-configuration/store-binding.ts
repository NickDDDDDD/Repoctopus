import { createHash } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export interface StoreBindingIntent {
  schemaVersion: 1;
  kind: 'StoreBindingIntent';
  actionId: string;
  requestId: string;
  action: 'prepare-root' | 'register-store' | 'write-pointer';
  storeId: string;
  repositoryId: string;
  pointer?: {
    path: 'openspec/config.yaml';
    before: string | null;
    after: string;
  };
  root?: {
    disposition: 'registered-exact' | 'healthy-unregistered' | 'missing-root';
    providerVersion: string;
    workspaceRoot: string;
    initializationArgs: readonly string[];
    evidenceDigest: `sha256:${string}`;
  };
  digest: `sha256:${string}`;
}

export interface StoreBindingReceipt {
  schemaVersion: 1;
  kind: 'StoreBindingReceipt';
  actionId: string;
  intentDigest: `sha256:${string}`;
  result:
    | 'initialized'
    | 'already-healthy'
    | 'registered'
    | 'already-registered'
    | 'written'
    | 'recovered';
  evidenceDigest: `sha256:${string}`;
  resultDigest: `sha256:${string}`;
  completedAt: string;
}

export function createStoreBindingIntent(
  input: Omit<StoreBindingIntent, 'schemaVersion' | 'kind' | 'digest'>,
): StoreBindingIntent {
  if (input.action === 'prepare-root') {
    if (!input.root || input.pointer) {
      throw new Error('Root preparation Intent requires only root preparation input');
    }
    if (
      input.root.initializationArgs.length === 0 ||
      input.root.initializationArgs.some((argument) => argument.length === 0)
    ) {
      throw new Error('Root preparation Intent requires exact non-empty argv');
    }
  } else if (input.action === 'write-pointer') {
    if (!input.pointer || input.root) {
      throw new Error('Store pointer Intent requires only pointer input');
    }
  } else if (input.pointer || input.root) {
    throw new Error('Store registration Intent cannot contain root or pointer input');
  }
  const stable = { schemaVersion: 1 as const, kind: 'StoreBindingIntent' as const, ...input };
  return { ...stable, digest: sha256(stable) };
}

export function createStoreBindingReceipt(
  input: Omit<StoreBindingReceipt, 'schemaVersion' | 'kind' | 'resultDigest'>,
): StoreBindingReceipt {
  const stable = { schemaVersion: 1 as const, kind: 'StoreBindingReceipt' as const, ...input };
  return { ...stable, resultDigest: sha256(stable) };
}
