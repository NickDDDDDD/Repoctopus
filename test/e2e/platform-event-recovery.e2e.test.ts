import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { build } from 'esbuild';
import { afterEach, expect, it } from 'vitest';

import { runCli } from './cli.js';

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const processes: ChildProcessWithoutNullStreams[] = [];
const productRoot = path.resolve(import.meta.dirname, '..', '..');

afterEach(async () => {
  await Promise.all(processes.splice(0).map((child) => terminate(child)));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createWorkspace(): Promise<{ root: string; fixture: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'repoctopus-event-recovery-'));
  const buildRoot = await mkdtemp(path.join(productRoot, 'test', '.platform-event-recovery-'));
  roots.push(root, buildRoot);
  await writeFile(
    path.join(root, 'repoctopus.yaml'),
    `apiVersion: repoctopus/v1alpha1
kind: RepoctopusProject
project:
  id: platform-event-recovery
repositories:
  - id: workspace
    path: .
composition:
  plugins: []
profiles:
  - id: verify
    nodes:
      - id: noop
        type: command
        repository: workspace
        executable: node
        args: [-e, "process.exit(0)"]
`,
  );
  const fixture = path.join(buildRoot, 'platform-event-process.mjs');
  await build({
    entryPoints: [path.join(productRoot, 'test', 'fixtures', 'platform-event-process.ts')],
    outfile: fixture,
    bundle: true,
    packages: 'external',
    platform: 'node',
    target: 'node22',
    format: 'esm',
    logLevel: 'silent',
  });
  return { root, fixture };
}

function fixtureEnvironment(secret: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env, GITHUB_WEBHOOK_SECRET: secret };
  for (const key of Object.keys(environment)) {
    if (key.startsWith('OTEL_EXPORTER_OTLP')) delete environment[key];
  }
  return environment;
}

function startIngress(input: { fixture: string; root: string; secret: string }) {
  const child = spawn(process.execPath, [input.fixture, 'ingress', productRoot, input.root], {
    cwd: productRoot,
    env: fixtureEnvironment(input.secret),
  });
  processes.push(child);
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  return {
    child,
    output: () => output,
    ready: new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`Ingress did not start: ${output}`)),
        10_000,
      );
      const inspect = () => {
        for (const line of output.split(/\r?\n/u)) {
          if (!line.startsWith('{')) continue;
          const value = JSON.parse(line) as { type?: string; origin?: string };
          if (value.type === 'ready' && value.origin) {
            clearTimeout(timeout);
            resolve(value.origin);
            return;
          }
        }
        setTimeout(inspect, 10);
      };
      child.once('exit', (code, signal) => {
        clearTimeout(timeout);
        reject(new Error(`Ingress exited before ready (${code ?? signal}): ${output}`));
      });
      inspect();
    }),
  };
}

function sendSignedWebhook(input: {
  origin: string;
  body: Buffer;
  secret: string;
  deliveryId: string;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const signature = `sha256=${createHmac('sha256', input.secret).update(input.body).digest('hex')}`;
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      new URL('/webhooks/github', input.origin),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(input.body.byteLength),
          'x-github-delivery': input.deliveryId,
          'x-github-event': 'pull_request',
          'x-hub-signature-256': signature,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
          });
        });
      },
    );
    request.once('error', reject);
    request.end(input.body);
  });
}

async function terminate(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
}

it('recovers a signed webhook from a forcibly stopped ingress process', async () => {
  const { root, fixture } = await createWorkspace();
  const secret = 'fixture-secret-must-not-leak';
  const deliveryId = 'recovery-delivery-1';
  const body = Buffer.from(
    JSON.stringify({ action: 'closed', token: 'payload-token-must-not-leak' }),
  );

  const firstIngress = startIngress({ fixture, root, secret });
  const first = await sendSignedWebhook({
    origin: await firstIngress.ready,
    body,
    secret,
    deliveryId,
  });
  expect(first).toMatchObject({ status: 202, body: { accepted: true, duplicate: false } });
  const envelopeId = first.body.envelopeId as string;
  await terminate(firstIngress.child);

  const pending = await runCli<{ status: string; receipts: unknown[] }>({
    packageRoot: productRoot,
    cwd: root,
    args: ['event', 'status', '--workspace', root, '--envelope', envelopeId],
    environment: fixtureEnvironment(secret),
  });
  expect(pending.result).toMatchObject({ status: 'pending', receipts: [] });

  const restartedIngress = startIngress({ fixture, root, secret });
  const duplicate = await sendSignedWebhook({
    origin: await restartedIngress.ready,
    body,
    secret,
    deliveryId,
  });
  expect(duplicate).toMatchObject({
    status: 202,
    body: { accepted: true, duplicate: true, envelopeId },
  });
  await terminate(restartedIngress.child);

  const runner = await execFileAsync(process.execPath, [fixture, 'runner', productRoot, root], {
    cwd: productRoot,
    env: fixtureEnvironment(secret),
  });
  expect(JSON.parse(runner.stdout.trim())).toEqual({ type: 'processed', processed: 1 });

  const completed = await runCli<{ status: string; attempts: number; receipts: unknown[] }>({
    packageRoot: productRoot,
    cwd: root,
    args: ['event', 'status', '--workspace', root, '--envelope', envelopeId],
    environment: fixtureEnvironment(secret),
  });
  expect(completed.result).toMatchObject({
    status: 'completed',
    attempts: 1,
    receipts: [{ result: 'completed', attempt: 1 }],
  });

  const output = [
    firstIngress.output(),
    restartedIngress.output(),
    runner.stdout,
    JSON.stringify(pending),
    JSON.stringify(completed),
  ].join('\n');
  expect(output).not.toMatch(/fixture-secret|payload-token|x-hub-signature|"payload":/iu);
}, 30_000);
