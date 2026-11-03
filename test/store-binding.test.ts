import { describe, expect, it } from 'vitest';

import {
  createStoreBindingIntent,
  createStoreBindingReceipt,
} from '../domains/project-configuration/store-binding.js';

function rootIntent(overrides: { requestId?: string; providerVersion?: string } = {}) {
  return createStoreBindingIntent({
    actionId: 'prepare-root',
    requestId: overrides.requestId ?? 'request-1',
    action: 'prepare-root',
    storeId: 'team-platform',
    repositoryId: 'workspace',
    root: {
      disposition: 'missing-root',
      providerVersion: overrides.providerVersion ?? '1.14.3',
      workspaceRoot: 'C:/workspace',
      initializationArgs: ['init', 'C:/workspace', '--tools', 'none'],
      evidenceDigest: `sha256:${'a'.repeat(64)}`,
    },
  });
}

describe('Store binding transaction contracts', () => {
  it('gives identical root preparation facts the same stable identity', () => {
    expect(rootIntent()).toEqual(rootIntent());
    expect(rootIntent({ requestId: 'request-2' }).digest).not.toBe(rootIntent().digest);
    expect(rootIntent({ providerVersion: '1.15.0' }).digest).not.toBe(rootIntent().digest);
  });

  it('rejects action payloads that could widen the recorded side effect', () => {
    expect(() =>
      createStoreBindingIntent({
        actionId: 'prepare-root',
        requestId: 'request-1',
        action: 'prepare-root',
        storeId: 'team-platform',
        repositoryId: 'workspace',
      }),
    ).toThrow(/requires.*root/iu);
    expect(() =>
      createStoreBindingIntent({
        actionId: 'register-store',
        requestId: 'request-1',
        action: 'register-store',
        storeId: 'team-platform',
        repositoryId: 'workspace',
        root: rootIntent().root!,
      }),
    ).toThrow(/cannot contain/iu);
  });

  it('binds every Receipt to its exact Intent and observed evidence', () => {
    const intent = rootIntent();
    const receipt = createStoreBindingReceipt({
      actionId: intent.actionId,
      intentDigest: intent.digest,
      result: 'initialized',
      evidenceDigest: `sha256:${'b'.repeat(64)}`,
      completedAt: '2026-11-03T00:00:00.000Z',
    });
    expect(receipt).toEqual(
      createStoreBindingReceipt({
        actionId: intent.actionId,
        intentDigest: intent.digest,
        result: 'initialized',
        evidenceDigest: `sha256:${'b'.repeat(64)}`,
        completedAt: '2026-11-03T00:00:00.000Z',
      }),
    );
    expect(receipt.resultDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });
});
