import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { matchActiveDeliveryMergeRequest } from '../domains/delivery/merge-requests.js';
import type {
  DeliveryEvent,
  DeliveryGitPort,
  MergeRequestPort,
} from '../domains/delivery/ports.js';
import { DeliveryService } from '../domains/delivery/service.js';
import { initialDeliveryState } from '../domains/delivery/state.js';
import type {
  DeliveryMergeRequestSet,
  DeliveryState,
  MergeRequestReference,
} from '../domains/delivery/types.js';
import { FileDeliveryStore } from '../platform/delivery/file-delivery-store.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

const reference: MergeRequestReference = {
  provider: 'github',
  remoteIdentity: 'github.com/team/app',
  number: 42,
};

function mergeRequests(changeId: string): DeliveryMergeRequestSet {
  return {
    change: {
      role: 'change',
      repositoryId: 'repoctopus',
      remoteIdentity: 'github.com/team/repoctopus',
      sourceBranch: `feat/${changeId}`,
      targetBranch: 'main',
      mergeRequest: {
        provider: 'github',
        repositoryId: 'repoctopus',
        number: 8,
        url: 'https://github.com/team/repoctopus/pull/8',
      },
    },
    business: [
      {
        role: 'business',
        repositoryId: 'app',
        remoteIdentity: reference.remoteIdentity,
        sourceBranch: `feat/${changeId}`,
        targetBranch: 'main',
        mergeRequest: {
          provider: reference.provider,
          repositoryId: 'app',
          number: reference.number,
          url: 'https://github.com/team/app/pull/42',
        },
      },
    ],
  };
}

function activeState(changeId: string): DeliveryState {
  return {
    ...initialDeliveryState(changeId, '2026-01-01T00:00:00.000Z'),
    stateVersion: 1,
    status: 'in_review',
    mergeRequests: mergeRequests(changeId),
  };
}

function event(state: DeliveryState): DeliveryEvent {
  return {
    schemaVersion: 1,
    eventId: `event-${state.changeId}`,
    changeId: state.changeId,
    stateVersion: state.stateVersion,
    timestamp: state.updatedAt,
    type: 'delivery.action',
    data: {},
  };
}

async function persist(store: FileDeliveryStore, state: DeliveryState): Promise<void> {
  await store.commit({ state, previousStateVersion: null, event: event(state) });
}

const unusedGit: DeliveryGitPort = {
  checkpoint: () => Promise.reject(new Error('not used')),
  inspect: () => Promise.reject(new Error('not used')),
  push: () => Promise.reject(new Error('not used')),
};

const mergedRequests: MergeRequestPort = {
  capability: () =>
    Promise.resolve({
      name: 'branch-protection',
      status: 'available',
      blocking: false,
      diagnosticCode: 'available',
    }),
  find: () => Promise.resolve(null),
  create: () => Promise.reject(new Error('not used')),
  update: () => Promise.reject(new Error('not used')),
  status: (identity) =>
    Promise.resolve({
      ...identity,
      state: 'merged',
      ci: 'passed',
      review: 'approved',
      conversationsResolved: true,
      mergeCommit: 'merge-app',
      mergedAt: '2026-01-01T00:01:00.000Z',
    }),
};

describe('delivery merge request mapping', () => {
  it('prefers one active business MR over merged recovery candidates and excludes the Change MR', () => {
    const matching = activeState('matching-change');
    const terminal = { ...activeState('terminal-change'), status: 'merged' as const };
    expect(matchActiveDeliveryMergeRequest([matching, terminal], reference)).toEqual({
      status: 'matched',
      changeIds: ['matching-change'],
      diagnostic: null,
    });
    expect(
      matchActiveDeliveryMergeRequest([matching], {
        provider: 'github',
        remoteIdentity: 'github.com/team/repoctopus',
        number: 8,
      }),
    ).toEqual({
      status: 'not_found',
      changeIds: [],
      diagnostic: 'delivery-event-no-match',
    });
  });

  it('falls back to a merged Delivery so an interrupted Post-merge Run can recover', () => {
    const merged = { ...activeState('merged-change'), status: 'merged' as const };
    expect(matchActiveDeliveryMergeRequest([merged], reference)).toEqual({
      status: 'matched',
      changeIds: ['merged-change'],
      diagnostic: null,
    });
  });

  it('returns stable diagnostics for zero and multiple active matches', () => {
    expect(matchActiveDeliveryMergeRequest([], reference)).toEqual({
      status: 'not_found',
      changeIds: [],
      diagnostic: 'delivery-event-no-match',
    });
    expect(
      matchActiveDeliveryMergeRequest(
        [activeState('z-change'), activeState('a-change')],
        reference,
      ),
    ).toEqual({
      status: 'ambiguous',
      changeIds: ['a-change', 'z-change'],
      diagnostic: 'delivery-event-ambiguous-match',
    });
  });

  it('uses the same authoritative refresh transition for event and explicit entry points', async () => {
    const explicitRoot = await temporaryDirectory('repoctopus-delivery-explicit-refresh-');
    const eventRoot = await temporaryDirectory('repoctopus-delivery-event-refresh-');
    cleanup.push(explicitRoot, eventRoot);
    const explicitStore = new FileDeliveryStore(explicitRoot);
    const eventStore = new FileDeliveryStore(eventRoot);
    await persist(explicitStore, activeState('refresh-change'));
    await persist(eventStore, activeState('refresh-change'));
    const clock = () => new Date('2026-01-01T00:02:00.000Z');
    const explicitService = new DeliveryService(
      explicitStore,
      unusedGit,
      mergedRequests,
      { assertSatisfied: () => Promise.resolve() },
      clock,
    );
    const eventService = new DeliveryService(
      eventStore,
      unusedGit,
      mergedRequests,
      { assertSatisfied: () => Promise.resolve() },
      clock,
    );

    const explicit = await explicitService.refresh('refresh-change');
    const eventRefresh = await eventService.refreshForMergeRequest(reference);
    expect(eventRefresh.match).toEqual({
      status: 'matched',
      changeIds: ['refresh-change'],
      diagnostic: null,
    });
    expect(eventRefresh.state).toEqual(explicit);
    expect(eventRefresh.mergeRequestStatuses).toEqual([
      expect.objectContaining({ repositoryId: 'app', state: 'merged' }),
    ]);
  });

  it('rejects unpublished v1 state instead of silently migrating it', async () => {
    const root = await temporaryDirectory('repoctopus-delivery-v1-state-');
    cleanup.push(root);
    const deliveryRoot = path.join(root, '.repoctopus', 'deliveries', 'legacy-change');
    await mkdir(deliveryRoot, { recursive: true });
    await writeFile(
      path.join(deliveryRoot, 'state.json'),
      JSON.stringify({ schemaVersion: 1, changeId: 'legacy-change' }),
    );
    await expect(new FileDeliveryStore(root).load('legacy-change')).rejects.toThrow(
      /migration_required/i,
    );
  });
});
