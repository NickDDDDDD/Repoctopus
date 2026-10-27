import {
  decodeDesktopLaunchContext,
  normalizeDesktopLaunchContext,
  type DesktopLaunchContext,
} from '../../../domains/desktop/launcher.js';
import type { DesktopLaunchState } from '../shared/renderer-contract.js';

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

/** Process-lifetime activation history for one Desktop Shell. */
export class DesktopLaunchRegistry {
  private sequence = 0;
  private current: DesktopLaunchContext | null = null;
  private readonly contexts = new Map<string, DesktopLaunchContext>();

  constructor(initialContext: DesktopLaunchContext | null = null) {
    if (initialContext !== null) this.activate(initialContext);
  }

  activate(context: DesktopLaunchContext): DesktopLaunchState {
    const normalized = normalizeDesktopLaunchContext(context);
    this.sequence += 1;
    this.current = normalized;
    this.contexts.set(`${normalized.workspaceId}\0${normalized.changeId}`, normalized);
    return this.snapshot();
  }

  snapshot(): DesktopLaunchState {
    return {
      sequence: this.sequence,
      current: this.current === null ? null : { ...this.current },
      history: [...this.contexts.values()].map((context) => ({ ...context })),
    };
  }
}
