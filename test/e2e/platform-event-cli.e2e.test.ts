import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, expect, it } from 'vitest';

import {
  acceptDelivery,
  claimDelivery,
  deliveryEnvelope,
  settleDelivery,
} from '../../domains/platform-events/inbox.js';
import { FileEventInboxStore } from '../../platform/events/file-event-inbox-store.js';

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const productRoot = path.resolve(import.meta.dirname, '..', '..');
const cli = path.join(productRoot, 'bin', 'repoctopus.js');

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'repoctopus-event-cli-'));
  roots.push(root);
  await writeFile(
    path.join(root, 'repoctopus.yaml'),
    `apiVersion: repoctopus/v1alpha1
kind: RepoctopusWorkspace
workspace:
  id: event-cli-test
  repositoryId: workspace
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
  return root;
}

async function run(root: string, args: string[], environment: NodeJS.ProcessEnv = process.env) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [cli, ...args, '--workspace', root, '--json'],
    { cwd: productRoot, env: environment },
  );
  return { raw: stdout, envelope: JSON.parse(stdout) as Record<string, unknown> };
}

it('replays, inspects, and retries through the production CLI without exposing payload secrets', async () => {
  const root = await workspace();
  const replayed = deliveryEnvelope({
    provider: 'github',
    source: 'primary',
    deliveryId: 'cli-replay',
    eventType: 'pull_request',
    receivedAt: '2026-10-20T00:00:00.000Z',
    payload: {
      authorization: 'Bearer ghp_cli_must_not_leak_1234567890',
      headers: { cookie: 'session=cli-must-not-leak' },
      body: 'raw-cli-payload-must-not-leak',
    },
  });
  const replayFile = path.join(root, 'verified-envelope.json');
  await writeFile(replayFile, JSON.stringify(replayed));

  const first = await run(root, ['event', 'replay', '--file', replayFile]);
  const duplicate = await run(root, ['event', 'replay', '--file', replayFile]);
  const status = await run(root, ['event', 'status', '--envelope', replayed.envelopeId]);
  expect(first.envelope).toMatchObject({
    ok: true,
    result: { duplicate: false, event: { status: 'pending', stateVersion: 0 } },
  });
  expect(duplicate.envelope).toMatchObject({ ok: true, result: { duplicate: true } });
  expect(status.envelope).toMatchObject({
    ok: true,
    result: { envelopeId: replayed.envelopeId, status: 'pending' },
  });

  const deadLetter = deliveryEnvelope({
    provider: 'github',
    source: 'primary',
    deliveryId: 'cli-dead-letter',
    eventType: 'pull_request',
    receivedAt: '2026-10-20T00:00:00.000Z',
    payload: { token: 'cli-dead-letter-secret' },
  });
  const store = new FileEventInboxStore(root);
  await store.transaction(deadLetter.envelopeId, () => ({
    entry: acceptDelivery(deadLetter, '2026-10-20T00:00:00.000Z').entry,
    result: true,
  }));
  const claimed = await store.transaction(deadLetter.envelopeId, (current) => {
    const entry = claimDelivery({
      entry: current!,
      owner: 'seed-runner',
      token: 'seed-lease-token',
      timestamp: '2026-10-20T00:00:01.000Z',
      leaseMs: 1_000,
    });
    return entry ? { entry, result: entry } : null;
  });
  await store.transaction(deadLetter.envelopeId, (current) => ({
    ...settleDelivery({
      entry: current!,
      leaseToken: claimed!.lease!.token,
      timestamp: '2026-10-20T00:00:01.100Z',
      result: 'dead_letter',
      diagnostic: 'repository-not-mapped',
    }),
    result: true,
  }));
  const retry = await run(root, ['event', 'retry', '--envelope', deadLetter.envelopeId]);
  expect(retry.envelope).toMatchObject({
    ok: true,
    result: {
      status: 'retry_wait',
      diagnostic: 'manual-retry-requested',
      receipts: [{ result: 'dead_letter' }, { result: 'retry' }],
    },
  });

  const output = [first.raw, duplicate.raw, status.raw, retry.raw].join('\n');
  expect(output).not.toMatch(
    /ghp_|cli-must-not-leak|raw-cli-payload|authorization|cookie|headers|seed-lease-token|"payload":/i,
  );
});

it('exports platform event logs and low-cardinality metrics after Inbox persistence', async () => {
  const paths: string[] = [];
  const server = createServer((request, response) => {
    paths.push(request.url ?? '');
    request.resume();
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/x-protobuf' });
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('OTLP fixture did not bind');

  const root = await workspace();
  const envelope = deliveryEnvelope({
    provider: 'github',
    source: 'primary',
    deliveryId: 'cli-telemetry',
    eventType: 'pull_request',
    receivedAt: '2026-10-20T00:00:00.000Z',
    payload: { token: 'otlp-secret-must-not-leak' },
  });
  const replayFile = path.join(root, 'telemetry-envelope.json');
  await writeFile(replayFile, JSON.stringify(envelope));
  try {
    const result = await run(root, ['event', 'replay', '--file', replayFile], {
      ...process.env,
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}`,
    });
    expect(result.envelope).toMatchObject({ ok: true, result: { duplicate: false } });
    expect(new Set(paths)).toEqual(new Set(['/v1/logs', '/v1/metrics']));
    expect(result.raw).not.toContain('otlp-secret-must-not-leak');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
