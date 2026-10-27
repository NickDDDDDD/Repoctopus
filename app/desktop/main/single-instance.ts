import {
  decodeDesktopLaunchContext,
  encodeDesktopLaunchContext,
  type DesktopLaunchContext,
} from '../../../domains/desktop/launcher.js';
import { desktopLaunchContextFromArguments } from './launch-context.js';

export const DESKTOP_SECOND_INSTANCE_CONTEXT_KEY = 'repoctopusLaunchContext';

export type DesktopSecondInstanceListener = (
  event: unknown,
  arguments_: string[],
  workingDirectory: string,
  additionalData: unknown,
) => void;

export interface DesktopSingleInstanceApplication {
  requestSingleInstanceLock(additionalData?: Record<string, unknown>): boolean;
  quit(): void;
  on(event: 'second-instance', listener: DesktopSecondInstanceListener): unknown;
}

function forwardedContext(
  arguments_: readonly string[],
  additionalData: unknown,
): DesktopLaunchContext | null {
  const encoded =
    typeof additionalData === 'object' && additionalData !== null
      ? (additionalData as Record<string, unknown>)[DESKTOP_SECOND_INSTANCE_CONTEXT_KEY]
      : undefined;
  if (typeof encoded === 'string') {
    try {
      return decodeDesktopLaunchContext(encoded);
    } catch {
      // Fall through to the bounded command-line representation.
    }
  }
  try {
    return desktopLaunchContextFromArguments(arguments_);
  } catch {
    return null;
  }
}

/** Claim process-lifetime ownership before starting the Desktop Host. */
export function claimDesktopSingleInstance(
  application: DesktopSingleInstanceApplication,
  initialContext: DesktopLaunchContext | null,
  activateOwner: (context: DesktopLaunchContext | null) => void,
): boolean {
  const additionalData =
    initialContext === null
      ? undefined
      : {
          [DESKTOP_SECOND_INSTANCE_CONTEXT_KEY]: encodeDesktopLaunchContext(initialContext),
        };
  if (!application.requestSingleInstanceLock(additionalData)) {
    application.quit();
    return false;
  }
  application.on('second-instance', (_event, arguments_, _workingDirectory, forwarded) => {
    activateOwner(forwardedContext(arguments_, forwarded));
  });
  return true;
}
