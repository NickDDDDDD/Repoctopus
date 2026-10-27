import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DESKTOP_IPC_CONTRACT_VERSION,
  DESKTOP_IPC_MAX_PAYLOAD_BYTES,
  DESKTOP_IPC_REQUESTS,
  type DesktopIpcRequest,
} from '../shared/renderer-contract.js';

interface DesktopSenderFrame {
  readonly url: string;
}

interface DesktopWebContents {
  readonly mainFrame: DesktopSenderFrame;
}

interface DesktopIpcEvent {
  readonly sender: DesktopWebContents;
  readonly senderFrame: DesktopSenderFrame | null;
}

const allowlistedChannels = new Set<string>(Object.values(DESKTOP_IPC_REQUESTS));

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function isTrustedDesktopIpcEvent(
  event: DesktopIpcEvent,
  expectedContents: DesktopWebContents,
  rendererEntry: string,
): boolean {
  if (
    event.sender !== expectedContents ||
    event.senderFrame === null ||
    event.senderFrame !== expectedContents.mainFrame
  ) {
    return false;
  }
  try {
    const sender = new URL(event.senderFrame.url);
    return sender.protocol === 'file:' && samePath(fileURLToPath(sender), rendererEntry);
  } catch {
    return false;
  }
}

export function validateDesktopIpcRequest(channel: string, input: unknown): DesktopIpcRequest {
  if (!allowlistedChannels.has(channel)) {
    throw new Error(`Desktop IPC channel is not in the versioned allowlist: ${channel}`);
  }
  let encoded: string;
  try {
    encoded = JSON.stringify(input);
  } catch {
    throw new Error('Desktop IPC payload is not serializable');
  }
  if (Buffer.byteLength(encoded ?? '', 'utf8') > DESKTOP_IPC_MAX_PAYLOAD_BYTES) {
    throw new Error('Desktop IPC payload exceeds the maximum size');
  }
  if (
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1 ||
    !('apiVersion' in input)
  ) {
    throw new Error('Desktop IPC payload does not match the closed request schema');
  }
  if (input.apiVersion !== DESKTOP_IPC_CONTRACT_VERSION) {
    throw new Error('Desktop IPC request uses an unsupported contract version');
  }
  return { apiVersion: DESKTOP_IPC_CONTRACT_VERSION };
}
