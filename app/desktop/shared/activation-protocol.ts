import type { DesktopTelemetryEndpoint } from '../../../services/desktop-telemetry-receiver.js';

export const DESKTOP_ACTIVATION_CONTRACT = 'repoctopus.desktop.activation/v1alpha1' as const;
export const DESKTOP_ACTIVATION_ARGUMENT = '--repoctopus-desktop-activation=' as const;

export interface DesktopRunContext {
  schemaVersion: 1;
  workspaceId: string;
  runId: string;
  changeId?: string;
}

export interface DesktopActivationRequest {
  apiVersion: typeof DESKTOP_ACTIVATION_CONTRACT;
  requestId: string;
  context: DesktopRunContext;
}

export interface DesktopActivationResponse {
  apiVersion: typeof DESKTOP_ACTIVATION_CONTRACT;
  requestId: string;
  status: 'ready';
  shellPid: number;
  receiver: DesktopTelemetryEndpoint;
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:@-]{0,255}$/u;
const REQUEST_ID = /^[a-f0-9]{64}$/u;

function safeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value);
}

export function isDesktopRunContext(value: unknown): value is DesktopRunContext {
  if (!value || typeof value !== 'object') return false;
  const context = value as Record<string, unknown>;
  return (
    context.schemaVersion === 1 &&
    safeId(context.workspaceId) &&
    safeId(context.runId) &&
    (context.changeId === undefined || safeId(context.changeId))
  );
}

function isReceiver(value: unknown): value is DesktopTelemetryEndpoint {
  if (!value || typeof value !== 'object') return false;
  const receiver = value as Record<string, unknown>;
  if (
    typeof receiver.origin !== 'string' ||
    typeof receiver.authorization !== 'string' ||
    !/^Bearer [A-Za-z0-9_-]{43,128}$/u.test(receiver.authorization)
  ) {
    return false;
  }
  try {
    const origin = new URL(receiver.origin);
    return origin.protocol === 'http:' && origin.hostname === '127.0.0.1' && origin.pathname === '/';
  } catch {
    return false;
  }
}

export function isDesktopActivationRequest(value: unknown): value is DesktopActivationRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Record<string, unknown>;
  return (
    request.apiVersion === DESKTOP_ACTIVATION_CONTRACT &&
    typeof request.requestId === 'string' &&
    REQUEST_ID.test(request.requestId) &&
    isDesktopRunContext(request.context)
  );
}

export function isDesktopActivationResponse(value: unknown): value is DesktopActivationResponse {
  if (!value || typeof value !== 'object') return false;
  const response = value as Record<string, unknown>;
  return (
    response.apiVersion === DESKTOP_ACTIVATION_CONTRACT &&
    typeof response.requestId === 'string' &&
    REQUEST_ID.test(response.requestId) &&
    response.status === 'ready' &&
    Number.isSafeInteger(response.shellPid) &&
    Number(response.shellPid) > 0 &&
    isReceiver(response.receiver)
  );
}

export function activationArgument(argv: readonly string[]): string | null {
  const values = argv
    .filter((value) => value.startsWith(DESKTOP_ACTIVATION_ARGUMENT))
    .map((value) => value.slice(DESKTOP_ACTIVATION_ARGUMENT.length));
  return values.length === 1 && values[0] ? values[0] : null;
}
