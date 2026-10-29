import type { OtlpSignal } from './otlp-http-receiver.js';
import {
  isObservationEnvelope,
  type ObservationEnvelope,
} from '../../../domains/trajectory/observation.js';

const ENVELOPE_ATTRIBUTE = 'repoctopus.observation.envelope';

function attribute(envelope: ObservationEnvelope) {
  return [{ key: ENVELOPE_ATTRIBUTE, value: { stringValue: JSON.stringify(envelope) } }];
}

/** Minimal standard OTLP/HTTP JSON payload used by both local and remote destinations. */
export function encodeObservationOtlpJson(
  envelopes: readonly ObservationEnvelope[],
  signal: OtlpSignal,
): Uint8Array {
  if (signal === 'log') {
    return Buffer.from(
      JSON.stringify({
        resourceLogs: [
          {
            scopeLogs: [
              {
                scope: { name: 'repoctopus-runtime', version: '0.1.0' },
                logRecords: envelopes.map((envelope) => ({
                  timeUnixNano: String(
                    BigInt(new Date(envelope.observedAt).getTime()) * 1_000_000n,
                  ),
                  eventName: `repoctopus.${envelope.eventType}`,
                  body: { stringValue: 'Repoctopus observation' },
                  attributes: attribute(envelope),
                })),
              },
            ],
          },
        ],
      }),
    );
  }
  if (signal === 'trace') {
    return Buffer.from(
      JSON.stringify({
        resourceSpans: [
          {
            scopeSpans: [
              {
                scope: { name: 'repoctopus-runtime', version: '0.1.0' },
                spans: envelopes.map((envelope) => ({
                  traceId: envelope.digest.slice(-32),
                  spanId: envelope.envelopeId.slice(-16),
                  name: `repoctopus.${envelope.eventType}`,
                  startTimeUnixNano: String(
                    BigInt(new Date(envelope.observedAt).getTime()) * 1_000_000n,
                  ),
                  endTimeUnixNano: String(
                    BigInt(new Date(envelope.observedAt).getTime()) * 1_000_000n,
                  ),
                  attributes: attribute(envelope),
                })),
              },
            ],
          },
        ],
      }),
    );
  }
  return Buffer.from(
    JSON.stringify({
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              scope: { name: 'repoctopus-runtime', version: '0.1.0' },
              metrics: [
                {
                  name: 'repoctopus.observation',
                  sum: {
                    aggregationTemporality: 1,
                    isMonotonic: true,
                    dataPoints: envelopes.map((envelope) => ({
                      asInt: '1',
                      timeUnixNano: String(
                        BigInt(new Date(envelope.observedAt).getTime()) * 1_000_000n,
                      ),
                      attributes: attribute(envelope),
                    })),
                  },
                },
              ],
            },
          ],
        },
      ],
    }),
  );
}

function collect(value: unknown, result: ObservationEnvelope[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collect(item, result);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.attributes)) {
    for (const candidate of record.attributes) {
      if (typeof candidate !== 'object' || candidate === null) continue;
      const entry = candidate as Record<string, unknown>;
      if (
        entry.key !== ENVELOPE_ATTRIBUTE ||
        typeof entry.value !== 'object' ||
        entry.value === null
      ) {
        continue;
      }
      const encoded = (entry.value as Record<string, unknown>).stringValue;
      if (typeof encoded !== 'string') continue;
      try {
        const envelope: unknown = JSON.parse(encoded);
        if (isObservationEnvelope(envelope)) result.push(envelope);
      } catch {
        // The enclosing OTLP request is valid but this unrelated attribute is not an envelope.
      }
    }
  }
  for (const [key, child] of Object.entries(record)) {
    if (key !== 'attributes') collect(child, result);
  }
}

export function decodeObservationOtlpJson(body: Uint8Array): readonly ObservationEnvelope[] {
  const payload: unknown = JSON.parse(Buffer.from(body).toString('utf8'));
  const observations: ObservationEnvelope[] = [];
  collect(payload, observations);
  const unique = new Map(observations.map((item) => [item.envelopeId, item]));
  return [...unique.values()];
}
