import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';

import { EvidenceCoordinator } from '../services/evidence-coordinator.js';
import { CompositionIdentity } from '../services/composition-identity.js';
import { FileRunStoreProvider } from '../plugins/run/file-run-store-provider.js';
import { EvidenceAdapters } from '../services/evidence-adapters.js';
import {
  localBrowserContributor,
  localCommandContributor,
  localServiceContributor,
} from '../plugins/evidence/local-adapter-contributors.js';
import { WorkflowRunCoordinator } from '../domains/runtime/workflow-runs.js';
import { createWorkflowPackage } from '../domains/workflow-contract/package.js';
import type {
  EvidenceTelemetryBatch,
  EvidenceTelemetryPort,
} from '../domains/evidence/telemetry.js';
import { createEvidenceTelemetryBatch } from '../domains/evidence/telemetry.js';
import type { SharedProjectConfig } from '../domains/project-configuration/types.js';
import { FileEvidenceTelemetryOutbox } from '../platform/telemetry/evidence-outbox.js';
import { FileRuntimeStore } from '../platform/runtime/file-runtime-store.js';
import { safeEvidenceAttributes } from '../platform/telemetry/evidence-mapping.js';
import {
  compositionFixture,
  commitGitRepository,
  createGitRepository,
  projectFixture,
  removeTemporaryDirectory,
  temporaryDirectory,
  workflowFixture,
} from './helpers/fixtures.js';

const cleanup: string[] = [];
const contexts: Context[] = [];
afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.fiber.dispose()));
  await Promise.all(cleanup.splice(0).map(removeTemporaryDirectory));
});

class RecoveringTelemetry implements EvidenceTelemetryPort {
  fail = true;
  readonly batches: EvidenceTelemetryBatch[] = [];

  export(batch: EvidenceTelemetryBatch): Promise<void> {
    if (this.fail) return Promise.reject(new Error('collector unavailable'));
    this.batches.push(structuredClone(batch));
    return Promise.resolve();
  }
}

describe('Evidence telemetry outbox', () => {
  it('keeps local facts on exporter failure and replays stable Run, Attempt, node, Artifact and Gate events', async () => {
    const root = await temporaryDirectory('repoctopus-evidence-telemetry-');
    cleanup.push(root);
    await createGitRepository(root, 'app');
    const workspace = await createGitRepository(root, 'workspace');
    const config: SharedProjectConfig = {
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'RepoctopusWorkspace',
      workspace: { id: 'telemetry', repositoryId: 'workspace' },
      repositories: [
        { id: 'workspace', path: '.' },
        { id: 'app', path: '../app' },
      ],
      profiles: [
        {
          id: 'verify',
          nodes: [
            {
              id: 'build',
              type: 'command',
              repository: 'app',
              dependsOn: [],
              required: true,
              executable: process.execPath,
              args: ['-e', "process.stdout.write('artifact body')"],
              timeoutMs: 5000,
              cache: false,
            },
          ],
        },
      ],
    };
    await writeFile(path.join(workspace, 'repoctopus.yaml'), JSON.stringify(config));
    await writeFile(path.join(workspace, '.gitignore'), '.repoctopus/\n');
    await commitGitRepository(workspace, 'configure workspace');
    const telemetry = new RecoveringTelemetry();
    const context = new Context();
    contexts.push(context);
    new CompositionIdentity(context, compositionFixture());
    new FileRunStoreProvider(context, { workspaceRoot: workspace });
    new EvidenceAdapters(context);
    await context.plugin(localCommandContributor);
    await context.plugin(localServiceContributor, { workspaceRoot: workspace });
    await context.plugin(localBrowserContributor, { workspaceRoot: workspace });
    await context.plugin(EvidenceCoordinator, { workspaceRoot: workspace, telemetry });
    const runtime = context.evidenceCoordinator;
    const workflowDefinition = structuredClone(workflowFixture().definition);
    workflowDefinition.steps[0]!.action.evidenceProfile = 'verify';
    const workflowRuntime = new WorkflowRunCoordinator(
      new FileRuntimeStore(workspace),
      { async export() {} },
      compositionFixture(),
    );
    await workflowRuntime.start({
      workflow: createWorkflowPackage(workflowDefinition),
      projectSnapshot: projectFixture(),
      runId: 'workflow-run-1',
    });
    await workflowRuntime.next('workflow-run-1');

    const completed = await runtime.run('verify', 'attempt-telemetry', 'workflow-run-1');
    expect(completed.bundle.outcome).toBe('passed');
    expect(completed.telemetry).toMatchObject({ status: 'pending', exportedEvents: 0 });
    expect((await runtime.status('attempt-telemetry')).attempt.status).toBe('completed');
    expect(
      (await new FileEvidenceTelemetryOutbox(workspace).readCursor('attempt-telemetry')).offset,
    ).toBe(0);

    telemetry.fail = false;
    await runtime.resume('attempt-telemetry');
    expect(telemetry.batches).toHaveLength(1);
    const batch = telemetry.batches[0]!;
    expect(batch).toMatchObject({
      runId: 'workflow-run-1',
      attemptId: 'attempt-telemetry',
      profileId: 'verify',
    });
    expect(batch.events.map((event) => event.type)).toEqual([
      'evidence.attempt.started',
      'evidence.node.completed',
      'evidence.artifact.recorded',
      'evidence.gate.evaluated',
      'evidence.attempt.completed',
    ]);
    expect(new Set(batch.events.map((event) => event.eventId)).size).toBe(batch.events.length);
    expect(batch.events.find((event) => event.type === 'evidence.node.completed')).toMatchObject({
      data: { nodeId: 'build', receiptId: completed.receipts[0]?.receiptId },
    });
    expect(batch.events.find((event) => event.type === 'evidence.artifact.recorded')).toMatchObject(
      {
        data: { receiptId: completed.receipts[0]?.receiptId, artifactType: 'command-stdout' },
      },
    );
    expect(batch.events.find((event) => event.type === 'evidence.gate.evaluated')).toMatchObject({
      data: { bundleId: completed.bundle.bundleId, gateStatus: 'satisfied' },
    });
    const reused = structuredClone(completed);
    reused.receipts[0]!.sourceReceiptId = 'source-receipt';
    const retryBatch = createEvidenceTelemetryBatch({
      workflowRunId: 'workflow-run-1',
      result: reused,
      gate: reused.gate,
    });
    expect(
      retryBatch.events.find((event) => event.type === 'evidence.node.completed'),
    ).toMatchObject({ data: { sourceReceiptId: 'source-receipt' } });
    expect(
      (await new FileEvidenceTelemetryOutbox(workspace).readCursor('attempt-telemetry')).offset,
    ).toBe(batch.events.length);

    await runtime.resume('attempt-telemetry');
    expect(telemetry.batches).toHaveLength(1);
  });

  it('maps only allowlisted metadata and excludes arbitrary private content', () => {
    const batch: EvidenceTelemetryBatch = {
      schemaVersion: 1,
      runId: 'run',
      attemptId: 'attempt',
      profileId: 'verify',
      compositionDigest: compositionFixture().compositionDigest,
      events: [
        {
          schemaVersion: 1,
          sequence: 1,
          eventId: 'event',
          type: 'evidence.node.completed',
          timestamp: '2026-01-01T00:00:00.000Z',
          runId: 'run',
          attemptId: 'attempt',
          data: {
            nodeId: 'build',
            status: 'passed',
            path: 'C:/private/source',
            output: 'secret command output',
            serviceLog: 'Bearer token-value-that-must-not-leak',
            healthBody: '{"password":"hidden"}',
            dom: '<html>private</html>',
            screenshot: 'raw-png-bytes',
            visualRequest: 'full visual request',
            visualResponse: 'full visual response',
          },
        },
      ],
    };
    const attributes = safeEvidenceAttributes(batch, batch.events[0]!);
    expect(attributes).toMatchObject({
      'repoctopus.run.id': 'run',
      'repoctopus.evidence.attempt.id': 'attempt',
      'repoctopus.evidence.nodeId': 'build',
      'repoctopus.evidence.status': 'passed',
    });
    expect(JSON.stringify(attributes)).not.toMatch(
      /private|secret command output|bearer|password|raw-png|visual request|visual response/iu,
    );
  });
});
