import { createServer } from 'node:http';

import { describe, expect, it } from 'vitest';

import { createChangeLifecycleSnapshot } from '../../domains/change-lifecycle/definition.js';
import { startRun } from '../../domains/engine/loop.js';
import type { TelemetryBatch } from '../../domains/runtime/types.js';
import { createRuleEvaluationReceipt } from '../../domains/telemetry/rule-evaluation.js';
import type { TrajectoryEvent } from '../../domains/trajectory/types.js';
import { OpenTelemetryExporter } from '../../platform/telemetry/opentelemetry/exporter.js';
import { compositionFixture, projectFixture, workflowFixture } from '../helpers/fixtures.js';

describe('telemetry measurement OTLP protocol', () => {
  it('exports correlated Skill, Rule, correction, and workflow facts with bounded Metric labels', async () => {
    const requests: Array<{ path: string; body: Buffer }> = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        requests.push({ path: request.url ?? '', body: Buffer.concat(chunks) });
        response.writeHead(200, { 'content-type': 'application/x-protobuf' });
        response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('OTLP receiver did not bind');
    try {
      const workflow = workflowFixture();
      const projectSnapshot = projectFixture();
      const base = startRun({
        workflow,
        runId: 'measurement-e2e',
        projectSnapshotDigest: projectSnapshot.digest,
        composition: compositionFixture(),
        timestamp: '2026-11-02T00:00:00.000Z',
        traceId: '2'.repeat(32),
      });
      const lifecycle = createChangeLifecycleSnapshot({
        identity: {
          workspaceId: projectSnapshot.projectId,
          changeId: 'measurement-e2e',
          runId: base.runId,
        },
      });
      const make = (
        sequence: number,
        type: TrajectoryEvent['type'],
        data: Record<string, unknown>,
      ): TrajectoryEvent => ({
        schemaVersion: 1,
        sequence,
        eventId: `measurement-e2e-${sequence}`,
        timestamp: `2026-11-02T00:00:0${sequence}.000Z`,
        type,
        runId: base.runId,
        stateVersion: sequence,
        compositionDigest: base.composition.compositionDigest,
        data,
      });
      const started = make(1, 'run.started', {});
      const consumed = make(2, 'skill.consumed', {
        phase: 'build',
        workId: 'work-1',
        workKind: 'task.implement',
        attempt: 1,
        invocationId: 'invoke-1',
        skillName: 'team-safe-skill',
        skillRole: 'augmentation',
        skillCategory: 'team',
        result: 'consumed',
      });
      const receipt = createRuleEvaluationReceipt({
        runId: base.runId,
        workId: 'work-1',
        attempt: 1,
        checkEpoch: 3,
        rule: { id: 'build.task-valid', version: '1.0.0', digest: `sha256:${'a'.repeat(64)}` },
        evaluator: { id: 'build.task-valid', version: '1.0.0' },
        applicable: true,
        expected: true,
        triggered: true,
        result: 'passed',
      });
      const validated = make(3, 'validator.completed', {
        phase: 'build',
        workId: 'work-1',
        workKind: 'task.implement',
        attempt: 1,
        validatorId: 'build.task-valid',
        result: 'accepted',
        ruleEvaluation: receipt,
      });
      const corrected = make(4, 'change.lifecycle.transitioned', {
        changeLifecycleTransition: {
          schemaVersion: 2,
          transitionId: 'verify.failed',
          definition: lifecycle.definition,
          revision: 4,
          previousWorkId: 'work-1',
          from: { phase: 'verify', status: 'running', checkEpoch: 3 },
          to: { phase: 'build', status: 'running', checkEpoch: 4 },
          workId: null,
          waitId: null,
          work: null,
          wait: null,
        },
        reason: 'PRIVATE-CORRECTION-TEXT',
      });
      const terminal = make(9, 'change.lifecycle.transitioned', {
        changeLifecycleTransition: {
          schemaVersion: 2,
          transitionId: 'archive.completed',
          definition: lifecycle.definition,
          revision: 9,
          from: { phase: 'archive', status: 'running', checkEpoch: 8 },
          to: { phase: 'archive', status: 'completed', checkEpoch: 9 },
          workId: null,
          waitId: null,
          work: null,
          wait: null,
        },
      });
      const trajectory = [started, consumed, validated, corrected, terminal];
      const batch: TelemetryBatch = {
        run: { ...base, status: 'completed', changeLifecycle: lifecycle },
        workflow,
        projectSnapshot,
        events: trajectory,
        trajectory,
      };
      await new OpenTelemetryExporter({
        timeoutMillis: 5_000,
        processEnvironment: { OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}` },
      }).export(batch);

      const payload = Buffer.concat(requests.map((item) => item.body)).toString('latin1');
      for (const name of [
        'repoctopus.measurement.skill',
        'repoctopus.measurement.rule',
        'repoctopus.measurement.workflow',
        'repoctopus.skill.usage',
        'repoctopus.rule.evaluation',
        'repoctopus.workflow.run.duration',
      ])
        expect(payload).toContain(name);
      expect(payload).toContain('team-safe-skill');
      expect(payload).toContain('build.task-valid');
      expect(payload).not.toContain('PRIVATE-CORRECTION-TEXT');
      const metrics = Buffer.concat(
        requests.filter((item) => item.path === '/v1/metrics').map((item) => item.body),
      ).toString('latin1');
      expect(metrics).not.toContain('team-safe-skill');
      expect(metrics).not.toContain('build.task-valid');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
