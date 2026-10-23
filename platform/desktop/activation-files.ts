import { mkdir, readFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  isDesktopActivationRequest,
  isDesktopActivationResponse,
  type DesktopActivationRequest,
  type DesktopActivationResponse,
} from '../../app/desktop/shared/activation-protocol.js';
import { atomicWriteJson } from '../filesystem/atomic-write.js';

const FILE = /^([a-f0-9]{64})\.(request|response)\.json$/u;

export function desktopActivationRoot(): string {
  return path.join(os.tmpdir(), 'repoctopus-desktop', 'v1', 'activations');
}

export function desktopActivationPaths(requestId: string): {
  request: string;
  response: string;
} {
  if (!/^[a-f0-9]{64}$/u.test(requestId)) throw new Error('Invalid desktop activation request id');
  const root = desktopActivationRoot();
  return {
    request: path.join(root, `${requestId}.request.json`),
    response: path.join(root, `${requestId}.response.json`),
  };
}

function assertActivationFile(file: string, kind: 'request' | 'response'): void {
  const resolved = path.resolve(file);
  if (path.dirname(resolved) !== path.resolve(desktopActivationRoot())) {
    throw new Error('Desktop activation file is outside the activation root');
  }
  const match = FILE.exec(path.basename(resolved));
  if (!match || match[2] !== kind) throw new Error(`Invalid desktop activation ${kind} file`);
}

export async function writeDesktopActivationRequest(
  file: string,
  request: DesktopActivationRequest,
): Promise<void> {
  assertActivationFile(file, 'request');
  if (!isDesktopActivationRequest(request)) throw new Error('Invalid desktop activation request');
  await mkdir(path.dirname(file), { recursive: true });
  await atomicWriteJson(file, request, { exclusive: true });
}

export async function readDesktopActivationRequest(
  file: string,
): Promise<DesktopActivationRequest> {
  assertActivationFile(file, 'request');
  const value = JSON.parse(await readFile(file, 'utf8')) as unknown;
  if (!isDesktopActivationRequest(value)) throw new Error('Invalid desktop activation request');
  return value;
}

export async function writeDesktopActivationResponse(
  requestFile: string,
  response: DesktopActivationResponse,
): Promise<void> {
  assertActivationFile(requestFile, 'request');
  if (!isDesktopActivationResponse(response)) throw new Error('Invalid desktop activation response');
  const paths = desktopActivationPaths(response.requestId);
  if (path.resolve(paths.request) !== path.resolve(requestFile)) {
    throw new Error('Desktop activation response does not match request file');
  }
  await atomicWriteJson(paths.response, response, { exclusive: true });
}

export async function readDesktopActivationResponse(
  file: string,
): Promise<DesktopActivationResponse | null> {
  assertActivationFile(file, 'response');
  try {
    const value = JSON.parse(await readFile(file, 'utf8')) as unknown;
    if (!isDesktopActivationResponse(value)) throw new Error('Invalid desktop activation response');
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function removeDesktopActivationFiles(requestId: string): Promise<void> {
  const files = Object.values(desktopActivationPaths(requestId));
  await Promise.all(
    files.map(async (file) => {
      try {
        await unlink(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }),
  );
}
