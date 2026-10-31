export const DESKTOP_RECEIVER_HEALTH_PROTOCOL = 'repoctopus.desktop.receiver-health/v1' as const;
export const DESKTOP_RECEIVER_HEALTH_MAX_BYTES = 1_024;

export interface DesktopReceiverHealth {
  schemaVersion: 1;
  protocolVersion: typeof DESKTOP_RECEIVER_HEALTH_PROTOCOL;
  pid: number;
}

const HEALTH_FIELDS = ['pid', 'protocolVersion', 'schemaVersion'] as const;

function validPid(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

export function serializeDesktopReceiverHealth(pid: number): string {
  if (!validPid(pid))
    throw new Error('Desktop receiver health pid must be a positive safe integer');
  return JSON.stringify({
    schemaVersion: 1,
    protocolVersion: DESKTOP_RECEIVER_HEALTH_PROTOCOL,
    pid,
  } satisfies DesktopReceiverHealth);
}

export function parseDesktopReceiverHealth(
  contentType: string | null,
  source: string,
): DesktopReceiverHealth | null {
  if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') return null;
  if (Buffer.byteLength(source, 'utf8') > DESKTOP_RECEIVER_HEALTH_MAX_BYTES) return null;

  try {
    const value = JSON.parse(source) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const candidate = value as Record<string, unknown>;
    if (Object.keys(candidate).sort().join(',') !== HEALTH_FIELDS.join(',')) return null;
    if (
      candidate.schemaVersion !== 1 ||
      candidate.protocolVersion !== DESKTOP_RECEIVER_HEALTH_PROTOCOL ||
      !validPid(candidate.pid)
    ) {
      return null;
    }
    return {
      schemaVersion: 1,
      protocolVersion: DESKTOP_RECEIVER_HEALTH_PROTOCOL,
      pid: candidate.pid,
    };
  } catch {
    return null;
  }
}
