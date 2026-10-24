import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { RunState } from '../domains/engine/types.js';
import {
  planChangeLifecycleMigration,
  type LegacyLifecycleRecord,
} from '../domains/change-lifecycle/migration.js';
import {
  applyChangeLifecycleMigration,
  type ChangeLifecycleMigrationIntent,
} from '../domains/change-lifecycle/migration-transaction.js';
import { postMergeTriggerFacts } from '../domains/post-merge/run.js';
import type { SpecificationApprovalState } from '../domains/specification/types.js';
import { createSpecificationApprovalMigrationPlan } from '../domains/specification/planning-approval.js';
import { FileDeliveryStore } from '../platform/delivery/file-delivery-store.js';
import { FileDeliveryV3Store } from '../platform/delivery/file-delivery-v3-store.js';
import { FileRuntimeStore } from '../platform/runtime/file-runtime-store.js';
import { FileChangeLifecycleMigrationStore } from '../platform/runtime/file-change-lifecycle-migration-store.js';
import { FilePlanningApprovalStore } from '../platform/specification/file-planning-approval-store.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

type LegacyFixtureKind =
  | 'generic-run'
  | 'planning-approval'
  | 'delivery-v2'
  | 'delivery-v3'
  | 'post-merge-run';

interface LegacyLifecycleFixture {
  id: string;
  kind: LegacyFixtureKind;
  authority: string;
  identity: Record<string, string>;
  inputs: string[];
  nextAction: string;
  externalSideEffects: string[];
  state: Record<string, unknown>;
}

interface LegacyLifecycleFixtureInventory {
  schemaVersion: 1;
  fixtures: LegacyLifecycleFixture[];
}

const inventoryFile = path.resolve(
  import.meta.dirname,
  'fixtures',
  'change-lifecycle-migration',
  'inventory.json',
);
const cleanup: string[] = [];

afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

async function inventory(): Promise<LegacyLifecycleFixtureInventory> {
  return JSON.parse(await readFile(inventoryFile, 'utf8')) as LegacyLifecycleFixtureInventory;
}

async function writeState(workspace: string, fixture: LegacyLifecycleFixture): Promise<void> {
  let file: string;
  if (fixture.kind === 'generic-run' || fixture.kind === 'post-merge-run') {
    file = path.join(workspace, '.repoctopus', 'runs', fixture.identity.runId!, 'run.json');
  } else if (fixture.kind === 'planning-approval') {
    file = path.join(
      workspace,
      '.repoctopus',
      'specification-approvals',
      fixture.identity.changeId!,
      'state.json',
    );
  } else {
    file = path.join(
      workspace,
      '.repoctopus',
      'deliveries',
      fixture.identity.changeId!,
      'state.json',
    );
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(fixture.state, null, 2)}\n`);
}

async function fileManifest(root: string, prefix = ''): Promise<Record<string, string>> {
  const manifest: Record<string, string> = {};
  for (const entry of (await readdir(path.join(root, prefix), { withFileTypes: true })).sort(
    (left, right) => left.name.localeCompare(right.name),
  )) {
    const relative = prefix ? path.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) Object.assign(manifest, await fileManifest(root, relative));
    else if (entry.isFile()) {
      manifest[relative.replaceAll('\\', '/')] = createHash('sha256')
        .update(await readFile(path.join(root, relative)))
        .digest('hex');
    }
  }
  return manifest;
}

async function inspectFixture(workspace: string, fixture: LegacyLifecycleFixture): Promise<void> {
  if (fixture.kind === 'generic-run' || fixture.kind === 'post-merge-run') {
    const inspected = await new FileRuntimeStore(workspace).inspect(fixture.identity.runId!);
    expect(inspected.state).toEqual(fixture.state);
    if (fixture.kind === 'post-merge-run') {
      expect(() => postMergeTriggerFacts((inspected.state as RunState).trigger)).not.toThrow();
    }
    return;
  }
  if (fixture.kind === 'planning-approval') {
    const loaded = await new FilePlanningApprovalStore(workspace).load(fixture.identity.changeId!);
    expect(loaded).toEqual(fixture.state as unknown as SpecificationApprovalState);
    return;
  }
  const loaded =
    fixture.kind === 'delivery-v2'
      ? await new FileDeliveryStore(workspace).load(fixture.identity.changeId!)
      : await new FileDeliveryV3Store(workspace).load(fixture.identity.changeId!);
  expect(loaded).toEqual(fixture.state);
}

describe('change lifecycle migration fixture baseline', () => {
  it('records authority, identity, inputs, next action, and external side effects', async () => {
    const catalog = await inventory();

    expect(catalog.schemaVersion).toBe(1);
    expect(
      catalog.fixtures.map((fixture) => ({
        id: fixture.id,
        kind: fixture.kind,
        authority: fixture.authority,
        identity: fixture.identity,
        inputCount: fixture.inputs.length,
        nextAction: fixture.nextAction,
        externalSideEffects: fixture.externalSideEffects,
      })),
    ).toEqual([
      {
        id: 'generic-run-waiting',
        kind: 'generic-run',
        authority: 'runtime-run-store',
        identity: { runId: 'legacy-generic-run', workflow: 'default@1.0.0' },
        inputCount: 4,
        nextAction: 'inspect the pending generic checkpoint before choosing a lifecycle phase',
        externalSideEffects: [],
      },
      {
        id: 'planning-approval-approved',
        kind: 'planning-approval',
        authority: 'specification-planning-approval-store',
        identity: {
          changeId: 'legacy-planning',
          snapshotDigest: 'sha256:c35b96c7c31ee1ff3a97b361ea62d28679c9e79811c77e475ff183ee2a465600',
        },
        inputCount: 5,
        nextAction:
          'recompute the semantic planning manifest and request a trusted migration decision',
        externalSideEffects: ['published change branch'],
      },
      {
        id: 'delivery-v2-in-review',
        kind: 'delivery-v2',
        authority: 'delivery-v2-store',
        identity: {
          changeId: 'legacy-delivery-v2',
          snapshotDigest: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
        },
        inputCount: 3,
        nextAction: 'inspect the authoritative Change MR and require a migration decision',
        externalSideEffects: ['business branch pushed', 'business MR created', 'Change MR open'],
      },
      {
        id: 'delivery-v3-in-review',
        kind: 'delivery-v3',
        authority: 'delivery-v3-store',
        identity: {
          changeId: 'legacy-delivery-v3',
          snapshotDigest: 'sha256:9999999999999999999999999999999999999999999999999999999999999999',
        },
        inputCount: 3,
        nextAction: 'freeze and reconcile the complete Business MR collection',
        externalSideEffects: ['business branch pushed', 'business MR created'],
      },
      {
        id: 'post-merge-active',
        kind: 'post-merge-run',
        authority: 'runtime-run-store',
        identity: {
          runId: 'legacy-post-merge-active',
          changeId: 'legacy-post-merge',
        },
        inputCount: 3,
        nextAction: 'map the exact merge facts to Archive without creating a second Run',
        externalSideEffects: ['Business MR merged'],
      },
      {
        id: 'post-merge-completed',
        kind: 'post-merge-run',
        authority: 'runtime-run-store',
        identity: {
          runId: 'legacy-post-merge-completed',
          changeId: 'legacy-post-merge-completed',
        },
        inputCount: 3,
        nextAction: 'retain as completed history and do not replay side effects',
        externalSideEffects: [
          'Business MR merged',
          'specification archived',
          'closure commit pushed',
          'final Change MR created',
        ],
      },
    ]);
  });

  it('uses current read paths without rewriting any fixture when migration is disabled', async () => {
    const sourceBefore = createHash('sha256')
      .update(await readFile(inventoryFile))
      .digest('hex');
    const catalog = await inventory();
    const workspace = await temporaryDirectory('repoctopus-lifecycle-migration-fixtures-');
    cleanup.push(workspace);
    for (const fixture of catalog.fixtures) await writeState(workspace, fixture);
    const before = await fileManifest(workspace);

    for (const fixture of catalog.fixtures) await inspectFixture(workspace, fixture);

    expect(await fileManifest(workspace)).toEqual(before);
    expect(
      createHash('sha256')
        .update(await readFile(inventoryFile))
        .digest('hex'),
    ).toBe(sourceBefore);
  });

  it('classifies a legacy planning approval without silently reusing it', async () => {
    const catalog = await inventory();
    const fixture = catalog.fixtures.find((candidate) => candidate.kind === 'planning-approval')!;
    const workspace = await temporaryDirectory('repoctopus-planning-migration-plan-');
    cleanup.push(workspace);
    await writeState(workspace, fixture);
    const before = await fileManifest(workspace);
    const state = await new FilePlanningApprovalStore(workspace).load(
      fixture.identity.changeId!,
    );
    expect(state).not.toBeNull();

    expect(createSpecificationApprovalMigrationPlan(state!)).toMatchObject({
      kind: 'SpecificationApprovalMigrationPlan',
      changeId: 'legacy-planning',
      status: 'migration_required',
      persistedSnapshotDigest: fixture.identity.snapshotDigest,
      requiredActions: [
        'recompute-current-planning-manifest',
        'verify-current-publication-provenance',
        'request-new-trusted-human-decision',
      ],
      externalSideEffects: [],
    });
    expect(await fileManifest(workspace)).toEqual(before);
  });

  it('plans every legacy authority read-only with explicit migration outcomes', async () => {
    const catalog = await inventory();
    const workspace = await temporaryDirectory('repoctopus-lifecycle-migration-planner-');
    cleanup.push(workspace);
    for (const fixture of catalog.fixtures) await writeState(workspace, fixture);
    const before = await fileManifest(workspace);

    const plans = catalog.fixtures.map((fixture) =>
      planChangeLifecycleMigration(fixture as LegacyLifecycleRecord),
    );
    expect(plans.map((plan) => [plan.fixtureId, plan.status, plan.targetPhase])).toEqual([
      ['generic-run-waiting', 'manual_decision_required', null],
      ['planning-approval-approved', 'manual_decision_required', 'design'],
      ['delivery-v2-in-review', 'migration_required', null],
      ['delivery-v3-in-review', 'migratable', 'archive'],
      ['post-merge-active', 'migratable', 'archive'],
      ['post-merge-completed', 'completed_history', null],
    ]);
    expect(plans.every((plan) => plan.storeWrites.length === 0)).toBe(true);
    expect(plans.every((plan) => plan.platformCalls.length === 0)).toBe(true);
    expect(plans.every((plan) => /^sha256:[a-f0-9]{64}$/u.test(plan.digest))).toBe(true);
    expect(await fileManifest(workspace)).toEqual(before);
  });

  it('recovers a controlled migration after target creation without double-coordinator progress', async () => {
    const catalog = await inventory();
    const fixture = catalog.fixtures.find((candidate) => candidate.id === 'delivery-v3-in-review')!;
    const plan = planChangeLifecycleMigration(fixture);
    const workspace = await temporaryDirectory('repoctopus-lifecycle-migration-apply-');
    cleanup.push(workspace);
    await writeState(workspace, fixture);
    const legacyFile = path.join(
      workspace,
      '.repoctopus',
      'deliveries',
      fixture.identity.changeId!,
      'state.json',
    );
    const legacyDigest = createHash('sha256').update(await readFile(legacyFile)).digest('hex');
    const request = {
      schemaVersion: 1 as const,
      plan,
      target: {
        workspaceId: 'team-platform',
        changeId: fixture.identity.changeId!,
        generation: 2,
      },
      auditReferences: [`legacy:${fixture.authority}:${fixture.id}`],
    };
    let interrupt = true;
    const interruptedStore = new FileChangeLifecycleMigrationStore(workspace, {
      beforeReceiptWrite() {
        if (interrupt) {
          interrupt = false;
          throw new Error('simulated-migration-receipt-interruption');
        }
      },
    });
    const logicalRuns = new Set<string>();
    let coordinatorAttempts = 0;
    const startOrResumeTargetRun = (intent: ChangeLifecycleMigrationIntent) => {
      coordinatorAttempts += 1;
      logicalRuns.add(intent.targetRunId);
      return Promise.resolve({ runId: intent.targetRunId });
    };
    await expect(
      applyChangeLifecycleMigration({
        request,
        store: interruptedStore,
        startOrResumeTargetRun,
      }),
    ).rejects.toThrow('simulated-migration-receipt-interruption');

    const receipt = await applyChangeLifecycleMigration({
      request,
      store: new FileChangeLifecycleMigrationStore(workspace),
      startOrResumeTargetRun,
    });
    expect(receipt).toMatchObject({
      status: 'applied',
      legacyIdentity: fixture.identity,
      targetGeneration: 2,
      auditReferences: [`legacy:${fixture.authority}:${fixture.id}`],
    });
    expect(coordinatorAttempts).toBe(2);
    expect(logicalRuns).toEqual(new Set([receipt.targetRunId]));
    await expect(
      applyChangeLifecycleMigration({
        request,
        store: new FileChangeLifecycleMigrationStore(workspace),
        startOrResumeTargetRun,
      }),
    ).resolves.toEqual(receipt);
    expect(coordinatorAttempts).toBe(2);
    expect(createHash('sha256').update(await readFile(legacyFile)).digest('hex')).toBe(legacyDigest);
  });
});
