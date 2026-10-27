const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;

export interface DesktopLaunchContext {
  schemaVersion: 1;
  workspaceId: string;
  changeId: string;
  runId: string;
}

export type DesktopLaunchAttempt =
  | Readonly<{ status: 'started-or-activated' }>
  | Readonly<{ status: 'unsupported'; platform: string }>;

export interface DesktopLauncher {
  readonly activate: (context: DesktopLaunchContext) => Promise<DesktopLaunchAttempt>;
}

function identity(value: string, label: string): string {
  if (!IDENTITY.test(value)) throw new Error(`${label} must be a stable identity`);
  return value;
}

export function normalizeDesktopLaunchContext(context: DesktopLaunchContext): DesktopLaunchContext {
  if (context.schemaVersion !== 1) throw new Error('Desktop launch context version is unsupported');
  return {
    schemaVersion: 1,
    workspaceId: identity(context.workspaceId, 'Workspace id'),
    changeId: identity(context.changeId, 'Change id'),
    runId: identity(context.runId, 'Run id'),
  };
}

export function encodeDesktopLaunchContext(context: DesktopLaunchContext): string {
  return Buffer.from(JSON.stringify(normalizeDesktopLaunchContext(context)), 'utf8').toString(
    'base64url',
  );
}

export function decodeDesktopLaunchContext(value: string): DesktopLaunchContext {
  if (!value || value.length > 2_048 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error('Desktop launch context encoding is invalid');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw new Error('Desktop launch context encoding is invalid');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Desktop launch context encoding is invalid');
  }
  const context = parsed as Partial<DesktopLaunchContext>;
  if (
    context.schemaVersion !== 1 ||
    typeof context.workspaceId !== 'string' ||
    typeof context.changeId !== 'string' ||
    typeof context.runId !== 'string'
  ) {
    throw new Error('Desktop launch context encoding is invalid');
  }
  return normalizeDesktopLaunchContext(context as DesktopLaunchContext);
}
