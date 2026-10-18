import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { EvidenceService } from '../../domains/evidence/service.js';
import type { EvidenceExecutionPlan } from '../../domains/feedback/profile.js';
import type { VisualInspectionAdapter } from '../../domains/feedback/visual.js';
import {
  type BrowserHandlePort,
  LocalBrowserAdapter,
  type BrowserPagePort,
} from '../../platform/browser/browser-adapter.js';
import {
  expectedManagedChromiumExecutable,
  managedBrowserCacheRoot,
  readManagedChromiumMetadata,
} from '../../platform/browser/managed-browser.js';
import { FileArtifactStore } from '../../platform/evidence/file-artifact-store.js';
import { FileEvidenceStore } from '../../platform/evidence/file-evidence-store.js';
import { LocalCommandAdapter } from '../../platform/feedback/command-adapter.js';
import { LocalServiceAdapter } from '../../platform/feedback/service-adapter.js';
import { removeTemporaryDirectory, temporaryDirectory } from '../helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function portIsClosed(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(true));
  });
}

async function prepareBrowsers(workspace: string): Promise<{ version: string; system: string }> {
  const metadata = await readManagedChromiumMetadata();
  const managed = expectedManagedChromiumExecutable(
    managedBrowserCacheRoot(workspace),
    metadata.revision,
  );
  if (!managed) throw new Error(`Unsupported test platform: ${process.platform}`);
  await mkdir(path.dirname(managed), { recursive: true });
  await writeFile(managed, 'managed-browser-fixture');
  const system = path.join(workspace, process.platform === 'win32' ? 'msedge.exe' : 'chrome');
  await writeFile(system, 'system-browser-fixture');
  return { version: metadata.browserVersion, system };
}

function fakeBrowser(version: string, closed: string[]): BrowserHandlePort {
  const page: BrowserPagePort = {
    on: () => undefined,
    goto: () => Promise.resolve(),
    locator: () => ({
      waitFor: () => Promise.resolve(),
      textContent: () => Promise.resolve('Agent dashboard ready'),
    }),
    screenshot: () => Promise.resolve(Buffer.from('same-screen')),
    content: () => Promise.resolve('<main>Agent dashboard ready</main>'),
    url: () => 'http://127.0.0.1/dashboard',
  };
  return {
    version: () => version,
    newPage: () => Promise.resolve(page),
    close: () => {
      closed.push(version);
      return Promise.resolve();
    },
  };
}

function plan(workspace: string, port: number): EvidenceExecutionPlan {
  const fingerprint = 'f'.repeat(64);
  const serverScript = [
    "const http=require('node:http')",
    `http.createServer((q,r)=>{if(q.url==='/identity'){r.setHeader('content-type','application/json');r.end(JSON.stringify({fingerprint:'${fingerprint}'}));return}r.end('ready')}).listen(${port},'127.0.0.1')`,
  ].join(';');
  return {
    schemaVersion: 1,
    profileId: 'full-feedback',
    configDigest: 'config',
    order: ['managed-api', 'attached-api', 'desktop', 'mobile-system', 'visual'],
    nodes: [
      {
        id: 'managed-api',
        type: 'service',
        mode: 'managed',
        repository: 'backend',
        repositoryPath: workspace,
        dependsOn: [],
        required: true,
        executable: process.execPath,
        args: ['-e', serverScript],
        readiness: [
          { type: 'tcp', host: '127.0.0.1', port },
          { type: 'http', url: `http://127.0.0.1:${port}`, statusCodes: [200] },
        ],
        startupTimeoutMs: 5000,
        probeIntervalMs: 20,
        resourceKeys: [`port:${port}`],
      },
      {
        id: 'attached-api',
        type: 'service',
        mode: 'attached',
        repository: 'backend',
        repositoryPath: workspace,
        dependsOn: ['managed-api'],
        required: true,
        readiness: [{ type: 'http', url: `http://127.0.0.1:${port}`, statusCodes: [200] }],
        startupTimeoutMs: 1000,
        probeIntervalMs: 20,
        buildIdentity: { url: `http://127.0.0.1:${port}/identity`, jsonPath: 'fingerprint' },
      },
      {
        id: 'desktop',
        type: 'browser',
        repository: 'front',
        repositoryPath: workspace,
        dependsOn: ['managed-api'],
        required: true,
        source: 'managed',
        journey: {
          apiVersion: 'repoctopus/v1alpha1',
          kind: 'BrowserJourney',
          journeyId: 'desktop',
          viewport: { width: 1440, height: 900 },
          timeoutMs: 1000,
          actions: [
            { type: 'navigate', url: `http://127.0.0.1:${port}` },
            { type: 'assertVisible', selector: 'main' },
            { type: 'screenshot', name: 'desktop' },
          ],
        },
      },
      {
        id: 'mobile-system',
        type: 'browser',
        repository: 'front',
        repositoryPath: workspace,
        dependsOn: ['managed-api'],
        required: false,
        source: 'system',
        journey: {
          apiVersion: 'repoctopus/v1alpha1',
          kind: 'BrowserJourney',
          journeyId: 'mobile',
          viewport: { width: 390, height: 844, deviceScaleFactor: 2 },
          timeoutMs: 1000,
          actions: [{ type: 'screenshot', name: 'mobile' }],
        },
      },
      {
        id: 'visual',
        type: 'visual',
        repository: 'front',
        repositoryPath: workspace,
        dependsOn: ['desktop'],
        required: true,
        changeId: 'capture-implementation-feedback',
        browserNode: 'desktop',
        pageUrl: `http://127.0.0.1:${port}`,
        criteria: [
          { id: 'dashboard', text: 'The dashboard is visible', sourceRef: 'spec://dashboard' },
        ],
      },
    ],
  };
}

describe('service and browser Evidence profile', () => {
  it('collects all adapter results in one Bundle and releases owned resources', async () => {
    const workspace = await temporaryDirectory('repoctopus-full-feedback-');
    cleanup.push(workspace);
    const port = await freePort();
    const browsers = await prepareBrowsers(workspace);
    const closed: string[] = [];
    const artifacts = new FileArtifactStore(workspace);
    const visual: VisualInspectionAdapter = {
      inspect: (request) =>
        Promise.resolve({
          apiVersion: 'repoctopus/v1alpha1',
          kind: 'VisualInspectionResponse',
          responseId: 'visual-response',
          requestId: request.requestId,
          screenshotSha256: request.screenshot.sha256,
          findings: [
            {
              findingId: 'advisory',
              severity: 'info',
              summary: 'Dashboard is visually coherent',
              evidenceRefs: [request.screenshot.sha256],
            },
          ],
        }),
    };
    const result = await new EvidenceService(
      artifacts,
      new FileEvidenceStore(workspace),
      new LocalCommandAdapter(),
      undefined,
      undefined,
      {
        services: new LocalServiceAdapter(workspace),
        browser: new LocalBrowserAdapter(workspace, artifacts, {
          configuredExecutablePath: browsers.system,
          launcher: () => Promise.resolve(fakeBrowser(browsers.version, closed)),
        }),
        visual,
      },
    ).run(plan(workspace, port), 'f'.repeat(64));

    expect(result.bundle.outcome).toBe('passed_with_warnings');
    expect(
      result.receipts.map((receipt) => [receipt.nodeId, receipt.adapter, receipt.trust]),
    ).toEqual([
      ['managed-api', 'service/managed', 'verified'],
      ['attached-api', 'service/attached', 'verified'],
      ['desktop', 'browser/managed', 'verified'],
      ['mobile-system', 'browser/system', 'observed'],
      ['visual', 'visual/structured', 'verified'],
    ]);
    expect(result.decisionRequests).toEqual([]);
    expect(result.bundle.artifactDigests.length).toBeGreaterThanOrEqual(5);
    expect(closed).toHaveLength(2);
    await expect.poll(() => portIsClosed(port)).toBe(true);
  }, 20_000);

  it('keeps a requirements conflict incomplete and emits a human decision request', async () => {
    const workspace = await temporaryDirectory('repoctopus-conflict-feedback-');
    cleanup.push(workspace);
    const port = await freePort();
    const browsers = await prepareBrowsers(workspace);
    const artifacts = new FileArtifactStore(workspace);
    const conflict: VisualInspectionAdapter = {
      inspect: (request) =>
        Promise.resolve({
          apiVersion: 'repoctopus/v1alpha1',
          kind: 'VisualInspectionResponse',
          responseId: 'conflict-response',
          requestId: request.requestId,
          screenshotSha256: request.screenshot.sha256,
          findings: [
            {
              findingId: 'conflict',
              severity: 'error',
              summary: 'Spec and design disagree',
              evidenceRefs: [request.screenshot.sha256],
              conflict: {
                conflictId: 'toolbar-location',
                summary: 'Action location differs',
                impact: 'The interaction cannot satisfy both sources',
                sources: [
                  { sourceType: 'openspec', sourceRef: 'spec://dashboard', requirement: 'Toolbar' },
                  { sourceType: 'design', sourceRef: 'design://dashboard', requirement: 'Footer' },
                ],
              },
            },
          ],
        }),
    };
    const result = await new EvidenceService(
      artifacts,
      new FileEvidenceStore(workspace),
      new LocalCommandAdapter(),
      undefined,
      undefined,
      {
        services: new LocalServiceAdapter(workspace),
        browser: new LocalBrowserAdapter(workspace, artifacts, {
          configuredExecutablePath: browsers.system,
          launcher: () => Promise.resolve(fakeBrowser(browsers.version, [])),
        }),
        visual: conflict,
      },
    ).run(plan(workspace, port), 'f'.repeat(64));

    expect(result.bundle.outcome).toBe('incomplete');
    expect(result.bundle.checks).toContainEqual(
      expect.objectContaining({ nodeId: 'visual', status: 'incomplete' }),
    );
    expect(result.bundle.findings).toContainEqual(
      expect.objectContaining({ code: 'requirements-conflict' }),
    );
    expect(result.decisionRequests).toEqual([
      expect.objectContaining({
        kind: 'HumanDecisionRequest',
        decisionType: 'requirements-conflict',
        nodeId: 'visual',
      }),
    ]);
    await expect.poll(() => portIsClosed(port)).toBe(true);
  }, 20_000);
});
