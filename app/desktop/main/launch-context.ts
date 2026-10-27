import {
  decodeDesktopLaunchContext,
  type DesktopLaunchContext,
} from '../../../domains/desktop/launcher.js';

export const DESKTOP_LAUNCH_CONTEXT_FLAG = '--repoctopus-launch-context';

/** Reads the bounded initial activation context passed by the Runtime launcher. */
export function desktopLaunchContextFromArguments(
  arguments_: readonly string[],
): DesktopLaunchContext | null {
  const positions = arguments_.flatMap((argument, index) =>
    argument === DESKTOP_LAUNCH_CONTEXT_FLAG ? [index] : [],
  );
  if (positions.length === 0) return null;
  if (positions.length !== 1) throw new Error('Desktop launch context flag must be unique');
  const encoded = arguments_[positions[0]! + 1];
  if (!encoded) throw new Error('Desktop launch context value is missing');
  return decodeDesktopLaunchContext(encoded);
}
