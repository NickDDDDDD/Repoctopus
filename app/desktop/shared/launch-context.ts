const ARGUMENT_PREFIX = '--repoctopus-launch=';
const MAX_ENCODED_CHARS = 2_048;
const MAX_ID_CHARS = 256;

export interface DesktopLaunchContext {
  schemaVersion: 1;
  workspaceId: string;
  changeId: string;
  runId: string;
}

function boundedId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_ID_CHARS) {
    throw new Error(`Desktop launch ${label} must contain 1-${MAX_ID_CHARS} characters`);
  }
  return value;
}

export function parseDesktopLaunchContext(value: unknown): DesktopLaunchContext {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Desktop launch context must be an object');
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1) throw new Error('Unsupported desktop launch context version');
  if (
    Object.keys(candidate).some(
      (key) => !['schemaVersion', 'workspaceId', 'changeId', 'runId'].includes(key),
    )
  ) {
    throw new Error('Desktop launch context contains an unknown field');
  }
  return {
    schemaVersion: 1,
    workspaceId: boundedId(candidate.workspaceId, 'workspaceId'),
    changeId: boundedId(candidate.changeId, 'changeId'),
    runId: boundedId(candidate.runId, 'runId'),
  };
}

export function encodeDesktopLaunchContext(context: DesktopLaunchContext): string {
  const encoded = Buffer.from(JSON.stringify(parseDesktopLaunchContext(context))).toString(
    'base64url',
  );
  if (encoded.length > MAX_ENCODED_CHARS) throw new Error('Desktop launch context is oversized');
  return encoded;
}

export function decodeDesktopLaunchContext(encoded: string): DesktopLaunchContext {
  if (!encoded || encoded.length > MAX_ENCODED_CHARS) {
    throw new Error('Desktop launch context is missing or oversized');
  }
  try {
    return parseDesktopLaunchContext(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Desktop launch')) throw error;
    if (error instanceof Error && error.message.startsWith('Unsupported')) throw error;
    throw new Error('Desktop launch context is malformed', { cause: error });
  }
}

export function desktopLaunchContextArgument(context: DesktopLaunchContext): string {
  return `${ARGUMENT_PREFIX}${encodeDesktopLaunchContext(context)}`;
}

export function desktopLaunchContextFromArguments(
  arguments_: readonly string[],
): DesktopLaunchContext | null {
  const argument = arguments_.find((candidate) => candidate.startsWith(ARGUMENT_PREFIX));
  return argument ? decodeDesktopLaunchContext(argument.slice(ARGUMENT_PREFIX.length)) : null;
}
