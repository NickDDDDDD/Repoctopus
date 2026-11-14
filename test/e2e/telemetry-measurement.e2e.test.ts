import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { Context } from '@deepseek-ai/cordis';
import { describe, expect, it } from 'vitest';

import { startRun } from '../../domains/engine/loop.js';
import type { TelemetryBatch } from '../../domains/runtime/types.js';
import { createRuleEvaluationReceipt } from '../../domains/telemetry/rule-evaluation.js';
import type { TrajectoryEvent } from '../../domains/trajectory/types.js';
import { ObservationDelivery } from '../../services/observation-delivery.js';
import { WorkflowObservationTelemetry } from '../../services/observation-telemetry.js';
import { compositionFixture, projectFixture, workflowFixture } from '../helpers/fixtures.js';

function metricNames(payload: string): string[] {
  const parsed = JSON.parse(payload) as {
    resourceMetrics?: Array<{
      scopeMetrics?: Array<{ metrics?: Array<{ name?: string }> }>;
    }>;
  };
  return (
    parsed.resourceMetrics?.flatMap(
      (resource) =>
        resource.scopeMetrics?.flatMap(
          (scope) => scope.metrics?.flatMap((metric) => metric.name ?? []) ?? [],
        ) ?? [],
    ) ?? []
  );
}

describe('telemetry measurement OTLP protocol', () => {
  it('exports persisted Skill, Rule, correction, and workflow facts with bounded metrics', async () => {
    const requests: Array<{ path: string; body: string }> = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        requests.push({ path: request.url ?? '', body: Buffer.concat(chunks).toString('utf8') });
        response.writeHead(200).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('OTLP receiver did not bind');
    const directory = await mkdtemp(path.join(os.tmpdir(), 'repoctopus-measurement-'));
    const context = new Context();
    try {
      const workflow = workflowFixture();
      const projectSnapshot = projectFixture();
      const run = startRun({
        workflow,
        runId: 'measurement-e2e',
        projectSnapshotDigest: projectSnapshot.digest,
        composition: compositionFixture(),
        timestamp: '2026-11-02T00:00:00.000Z',
      });
      const receipt = createRuleEvaluationReceipt({
        runId: run.runId,
        workId: 'work-1',
        attempt: 1,
        checkEpoch: 3,
        rule: {
          id: 'build.task-valid',
          version: '1.0.0',
          digest: `sha256:${'a'.repeat(64)}`,
          category: 'builtin',
        },
        evaluator: { id: 'build.task-valid', version: '1.0.0' },
        applicable: true,
        expected: true,
        triggered: true,
        result: 'passed',
      });
      const make = (
        sequence: number,
        type: TrajectoryEvent['type'],
        data: Record<string, unknown>,
      ): TrajectoryEvent => ({
        schemaVersion: 1,
        sequence,
        eventId: `measurement-${sequence}`,
        timestamp: `2026-11-02T00:00:0${sequence}.000Z`,
        type,
        runId: run.runId,
        stateVersion: sequence,
        compositionDigest: run.composition.compositionDigest,
        data,
      });
      const commonSkill = {
        phase: 'build',
        workId: 'work-1',
        workKind: 'build.execute',
        attempt: 1,
        invocationId: 'invocation-1',
        skillName: 'team-safe-skill',
        skillRole: 'team-guidance',
        skillCategory: 'team',
      };
      const events = [
        make(1, 'run.started', {
          workflowName: run.workflowName,
          workflowVersion: run.workflowVersion,
          workflowRunResult: 'started',
        }),
        make(2, 'skill.consumed', { ...commonSkill, result: 'consumed' }),
        make(3, 'skill.outcome-recorded', { ...commonSkill, result: 'completed' }),
        make(4, 'validator.completed', {
          phase: 'build',
          workId: 'work-1',
          attempt: 1,
          validatorId: receipt.evaluator.id,
          ruleEvaluation: receipt,
          ruleId: receipt.rule.id,
          ruleDigest: receipt.rule.digest,
          ruleCategory: receipt.rule.category,
          evaluatorId: receipt.evaluator.id,
          evaluatorVersion: receipt.evaluator.version,
          ruleApplicable: receipt.applicable,
          ruleExpected: receipt.expected,
          ruleTriggered: receipt.triggered,
          ruleResult: receipt.result,
          result: 'accepted',
        }),
        make(5, 'skill.outcome-recorded', {
          ...commonSkill,
          result: 'corrected',
          reason: 'PRIVATE-CORRECTION-TEXT',
        }),
        make(9, 'change.lifecycle.transitioned', {
          workflowName: run.workflowName,
          workflowVersion: run.workflowVersion,
          workflowRunResult: 'completed',
          workflowRunDurationMs: 8_000,
        }),
      ];
      const batch: TelemetryBatch = {
        run: { ...run, status: 'completed' },
        workflow,
        projectSnapshot,
        events,
        trajectory: events,
      };
      const delivery = new ObservationDelivery(context, { workspaceRoot: directory });
      const telemetry = new WorkflowObservationTelemetry(delivery, {
        REPOCTOPUS_OTLP_DIAGNOSTICS: 'full',
        OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}`,
      });
      await telemetry.export(batch);
      await telemetry.export(batch);

      expect(requests).toHaveLength(3);
      const logPayload = requests.find((request) => request.path === '/v1/logs')!.body;
      expect(logPayload).toContain('team-safe-skill');
      expect(logPayload).toContain('build.task-valid');
      expect(logPayload).not.toContain('PRIVATE-CORRECTION-TEXT');

      const metricPayload = requests.find((request) => request.path === '/v1/metrics')!.body;
      const names = metricNames(metricPayload);
      for (const name of [
        'repoctopus.observation',
        'repoctopus.skill.usage',
        'repoctopus.rule.evaluation',
        'repoctopus.workflow.run',
        'repoctopus.workflow.run.duration',
      ]) {
        expect(names).toContain(name);
      }
      expect(metricPayload).not.toContain('team-safe-skill');
      expect(metricPayload).not.toContain('build.task-valid');
      expect(metricPayload).not.toContain('invocation-1');
      expect(metricPayload).not.toContain('work-1');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await context.fiber.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
