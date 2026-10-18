import { createHash } from 'node:crypto';

import type { EvidenceRunResult } from './service.js';
import type { EvidenceGateProjection } from './types.js';

export type EvidenceTelemetryEventType =
  | 'evidence.attempt.started'
  | 'evidence.node.completed'
  | 'evidence.artifact.recorded'
  | 'evidence.gate.evaluated'
  | 'evidence.attempt.completed';

export interface EvidenceTelemetryEvent {
  schemaVersion: 1;
  sequence: number;
  eventId: string;
  type: EvidenceTelemetryEventType;
  timestamp: string;
  runId: string | null;
  attemptId: string;
  data: Record<string, string | number | boolean>;
}

export interface EvidenceTelemetryBatch {
  schemaVersion: 1;
  runId: string | null;
  attemptId: string;
  profileId: string;
  events: EvidenceTelemetryEvent[];
}

export interface EvidenceTelemetryPort {
  export(batch: EvidenceTelemetryBatch): Promise<void>;
}

function eventId(attemptId: string, type: EvidenceTelemetryEventType, identity: string): string {
  return createHash('sha256').update(`${attemptId}:${type}:${identity}`).digest('hex');
}

export function createEvidenceTelemetryBatch(input: {
  workflowRunId: string | null;
  result: EvidenceRunResult;
  gate: EvidenceGateProjection;
}): EvidenceTelemetryBatch {
  const attempt = input.result.attempt;
  const events: Array<Omit<EvidenceTelemetryEvent, 'schemaVersion' | 'sequence'>> = [
    {
      eventId: eventId(attempt.attemptId, 'evidence.attempt.started', attempt.attemptId),
      type: 'evidence.attempt.started',
      timestamp: attempt.startedAt,
      runId: input.workflowRunId,
      attemptId: attempt.attemptId,
      data: {
        profileId: attempt.profileId,
        inputFingerprint: attempt.inputFingerprint,
      },
    },
  ];
  for (const receipt of input.result.receipts) {
    events.push({
      eventId: eventId(attempt.attemptId, 'evidence.node.completed', receipt.receiptId),
      type: 'evidence.node.completed',
      timestamp: receipt.completedAt,
      runId: input.workflowRunId,
      attemptId: attempt.attemptId,
      data: {
        nodeId: receipt.nodeId,
        receiptId: receipt.receiptId,
        adapter: receipt.adapter,
        trust: receipt.trust,
        freshness: receipt.freshness,
        status: receipt.status,
        durationMs: Math.max(0, Date.parse(receipt.completedAt) - Date.parse(receipt.startedAt)),
        ...(receipt.sourceReceiptId ? { sourceReceiptId: receipt.sourceReceiptId } : {}),
      },
    });
    for (const artifact of receipt.artifacts) {
      events.push({
        eventId: eventId(
          attempt.attemptId,
          'evidence.artifact.recorded',
          `${receipt.receiptId}:${artifact.sha256}`,
        ),
        type: 'evidence.artifact.recorded',
        timestamp: receipt.completedAt,
        runId: input.workflowRunId,
        attemptId: attempt.attemptId,
        data: {
          nodeId: receipt.nodeId,
          receiptId: receipt.receiptId,
          artifactDigest: artifact.sha256,
          artifactType: artifact.artifactType,
          artifactSize: artifact.size,
          mediaType: artifact.mediaType,
          redacted: artifact.redacted,
        },
      });
    }
  }
  events.push(
    {
      eventId: eventId(attempt.attemptId, 'evidence.gate.evaluated', input.gate.bundleId),
      type: 'evidence.gate.evaluated',
      timestamp: input.result.bundle.createdAt,
      runId: input.workflowRunId,
      attemptId: attempt.attemptId,
      data: {
        bundleId: input.gate.bundleId,
        outcome: input.gate.outcome,
        gateStatus: input.gate.status,
      },
    },
    {
      eventId: eventId(attempt.attemptId, 'evidence.attempt.completed', attempt.attemptId),
      type: 'evidence.attempt.completed',
      timestamp: attempt.completedAt ?? input.result.bundle.createdAt,
      runId: input.workflowRunId,
      attemptId: attempt.attemptId,
      data: { status: attempt.status },
    },
  );
  return {
    schemaVersion: 1,
    runId: input.workflowRunId,
    attemptId: attempt.attemptId,
    profileId: attempt.profileId,
    events: events.map((event, index) => ({ schemaVersion: 1, sequence: index + 1, ...event })),
  };
}
