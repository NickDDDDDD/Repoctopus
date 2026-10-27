import type { Attributes } from '@opentelemetry/api';

import type {
  EvidenceTelemetryBatch,
  EvidenceTelemetryEvent,
} from '../../domains/evidence/telemetry.js';

const ALLOWED_DATA = new Set([
  'adapter',
  'artifactDigest',
  'artifactSize',
  'artifactType',
  'bundleId',
  'durationMs',
  'freshness',
  'gateStatus',
  'inputFingerprint',
  'mediaType',
  'nodeId',
  'outcome',
  'profileId',
  'receiptId',
  'redacted',
  'sourceReceiptId',
  'status',
  'trust',
]);
const SENSITIVE_VALUE =
  /(bearer\s+|gh[opusr]_[a-z0-9]{20,}|api[-_]?key|password|secret|token|-----BEGIN [A-Z ]+PRIVATE KEY-----)/iu;
const ABSOLUTE_PATH = /^(?:[a-z]:[\\/]|\\\\|\/)/iu;

function safeString(value: string): boolean {
  return (
    value.length <= 256 &&
    !value.includes('\n') &&
    !value.includes('\r') &&
    !SENSITIVE_VALUE.test(value) &&
    !ABSOLUTE_PATH.test(value)
  );
}

export function safeEvidenceAttributes(
  batch: EvidenceTelemetryBatch,
  event: EvidenceTelemetryEvent,
): Attributes {
  const attributes: Attributes = {
    'repoctopus.evidence.event.id': event.eventId,
    'repoctopus.evidence.event.type': event.type,
    'repoctopus.evidence.event.sequence': event.sequence,
    'repoctopus.evidence.attempt.id': batch.attemptId,
    'repoctopus.evidence.profile.id': batch.profileId,
    'repoctopus.composition.digest': batch.compositionDigest,
    ...(batch.runId ? { 'repoctopus.run.id': batch.runId } : {}),
    ...(batch.workspaceId ? { 'repoctopus.workspace.id': batch.workspaceId } : {}),
    ...(batch.changeId ? { 'repoctopus.change.id': batch.changeId } : {}),
  };
  for (const [key, value] of Object.entries(event.data)) {
    if (!ALLOWED_DATA.has(key)) continue;
    if (typeof value === 'string' && safeString(value)) {
      attributes[`repoctopus.evidence.${key}`] = value;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      attributes[`repoctopus.evidence.${key}`] = value;
    } else if (typeof value === 'boolean') {
      attributes[`repoctopus.evidence.${key}`] = value;
    }
  }
  return attributes;
}
