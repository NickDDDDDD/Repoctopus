import { describe, expect, it } from 'vitest';

import type { EvidenceTelemetryBatch } from '../domains/evidence/telemetry.js';
import { mapEvidenceObservationEnvelopes } from '../platform/telemetry/evidence-observation-mapping.js';
import { encodeObservationEnvelopes } from '../platform/telemetry/opentelemetry/envelope-encoder.js';

function batch(): EvidenceTelemetryBatch {
  return {
    schemaVersion: 1,
    runId: 'run-evidence-envelope',
    workspaceId: 'workspace-evidence',
    changeId: 'change-evidence',
    attemptId: 'attempt-2',
    profileId: 'verify',
    compositionDigest: `sha256:${'a'.repeat(64)}`,
    events: [
      {
        schemaVersion: 1,
        sequence: 1,
        eventId: 'attempt-started',
        type: 'evidence.attempt.started',
        timestamp: '2026-10-27T08:00:00.000Z',
        runId: 'run-evidence-envelope',
        attemptId: 'attempt-2',
        data: { profileId: 'verify' },
      },
      {
        schemaVersion: 1,
        sequence: 2,
        eventId: 'node-completed',
        type: 'evidence.node.completed',
        timestamp: '2026-10-27T08:00:04.000Z',
        runId: 'run-evidence-envelope',
        attemptId: 'attempt-2',
        data: {
          nodeId: 'tests',
          receiptId: 'receipt-2',
          sourceReceiptId: 'receipt-1',
          trust: 'verified',
          freshness: 'reused',
          status: 'passed',
          durationMs: 3_000,
        },
      },
      {
        schemaVersion: 1,
        sequence: 3,
        eventId: 'artifact-recorded',
        type: 'evidence.artifact.recorded',
        timestamp: '2026-10-27T08:00:04.000Z',
        runId: 'run-evidence-envelope',
        attemptId: 'attempt-2',
        data: {
          nodeId: 'tests',
          receiptId: 'receipt-2',
          artifactDigest: 'b'.repeat(64),
          artifactType: 'test-log',
          artifactSize: 128,
          mediaType: 'text/plain',
          redacted: true,
        },
      },
      {
        schemaVersion: 1,
        sequence: 4,
        eventId: 'gate-evaluated',
        type: 'evidence.gate.evaluated',
        timestamp: '2026-10-27T08:00:05.000Z',
        runId: 'run-evidence-envelope',
        attemptId: 'attempt-2',
        data: { bundleId: 'bundle-2', outcome: 'passed', gateStatus: 'satisfied' },
      },
      {
        schemaVersion: 1,
        sequence: 5,
        eventId: 'attempt-completed',
        type: 'evidence.attempt.completed',
        timestamp: '2026-10-27T08:00:05.000Z',
        runId: 'run-evidence-envelope',
        attemptId: 'attempt-2',
        data: { status: 'superseded', durationMs: 5_000 },
      },
    ],
  };
}

describe('Evidence observation envelope mapping', () => {
  it('gives replay, superseded attempts, reused Receipts and Artifacts one destination-neutral projection', () => {
    const envelopes = mapEvidenceObservationEnvelopes(batch());
    expect(envelopes).toHaveLength(5);
    expect(new Set(envelopes.map((envelope) => envelope.envelopeId)).size).toBe(5);
    expect(envelopes[0]?.resource.attributes).toMatchObject({
      'repoctopus.workspace.id': 'workspace-evidence',
    });
    expect(envelopes[0]?.records[0]?.attributes).toMatchObject({
      'repoctopus.change.id': 'change-evidence',
    });

    const remote = encodeObservationEnvelopes(envelopes);
    const desktop = encodeObservationEnvelopes(envelopes);
    expect(desktop).toEqual(remote);
    expect(remote.logs.find((log) => log.eventName === 'evidence.node.completed')).toMatchObject({
      attributes: {
        'repoctopus.evidence.receipt_id': 'receipt-2',
        'repoctopus.evidence.source_receipt_id': 'receipt-1',
        'repoctopus.evidence.freshness': 'reused',
      },
    });
    expect(remote.logs.find((log) => log.eventName === 'evidence.artifact.recorded')).toMatchObject(
      {
        attributes: {
          'repoctopus.evidence.artifact_digest': 'b'.repeat(64),
          'repoctopus.evidence.redacted': true,
        },
      },
    );
    expect(
      remote.metrics.find((metric) => metric.name === 'repoctopus.evidence.node.duration'),
    ).toMatchObject({
      value: 3_000,
      attributes: {
        'repoctopus.evidence.result': 'passed',
        'repoctopus.evidence.freshness': 'reused',
      },
    });
    expect(JSON.stringify(remote.metrics)).not.toMatch(/run-evidence|attempt-2|receipt-2/u);
  });

  it('rejects Artifact bodies and sensitive values before they enter an envelope', () => {
    const candidate = batch();
    candidate.events[2]!.data.artifactBody = 'private Artifact contents';
    expect(() => mapEvidenceObservationEnvelopes(candidate)).toThrow(/unsafe evidence/iu);

    delete candidate.events[2]!.data.artifactBody;
    candidate.events[2]!.data.metadata = 'Bearer private-credential-value';
    expect(() => mapEvidenceObservationEnvelopes(candidate)).toThrow(/unsafe evidence/iu);
  });
});
