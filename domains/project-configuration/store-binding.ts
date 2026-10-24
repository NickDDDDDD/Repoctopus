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
  action: 'register-store' | 'write-pointer';
  storeId: string;
  repositoryId: string;
  pointer?: {
    path: 'openspec/config.yaml';
    before: string | null;
    after: string;
  };
  digest: `sha256:${string}`;
}

export interface StoreBindingReceipt {
  schemaVersion: 1;
  kind: 'StoreBindingReceipt';
  actionId: string;
  intentDigest: `sha256:${string}`;
  result: 'registered' | 'already-registered' | 'written' | 'recovered';
  evidenceDigest: `sha256:${string}`;
  resultDigest: `sha256:${string}`;
  completedAt: string;
}

export function createStoreBindingIntent(
  input: Omit<StoreBindingIntent, 'schemaVersion' | 'kind' | 'digest'>,
): StoreBindingIntent {
  const stable = { schemaVersion: 1 as const, kind: 'StoreBindingIntent' as const, ...input };
  return { ...stable, digest: sha256(stable) };
}

export function createStoreBindingReceipt(
  input: Omit<StoreBindingReceipt, 'schemaVersion' | 'kind' | 'resultDigest'>,
): StoreBindingReceipt {
  const stable = { schemaVersion: 1 as const, kind: 'StoreBindingReceipt' as const, ...input };
  return { ...stable, resultDigest: sha256(stable) };
}
