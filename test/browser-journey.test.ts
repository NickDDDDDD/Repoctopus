import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  BROWSER_JOURNEY_API_VERSION,
  compileBrowserJourney,
  type BrowserJourney,
} from '../domains/feedback/browser.js';
import {
  type BrowserHandlePort,
  LocalBrowserAdapter,
  type BrowserPagePort,
} from '../platform/browser/browser-adapter.js';
import { resolveBrowserSource } from '../platform/browser/browser-source.js';
import {
  expectedManagedChromiumExecutable,
  managedBrowserCacheRoot,
  readManagedChromiumMetadata,
} from '../platform/browser/managed-browser.js';
import { FileArtifactStore } from '../platform/evidence/file-artifact-store.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

function journey(
  actions: BrowserJourney['actions'],
  viewport: BrowserJourney['viewport'] = { width: 390, height: 844, deviceScaleFactor: 2 },
): BrowserJourney {
  return {
    apiVersion: BROWSER_JOURNEY_API_VERSION,
    kind: 'BrowserJourney',
    journeyId: 'dashboard-mobile',
    viewport,
    timeoutMs: 100,
    actions,
  };
}

async function prepareManagedBrowser(workspace: string): Promise<string> {
  const metadata = await readManagedChromiumMetadata();
  const executable = expectedManagedChromiumExecutable(
    managedBrowserCacheRoot(workspace),
    metadata.revision,
  );
  if (!executable) throw new Error(`Unsupported test platform: ${process.platform}`);
  await mkdir(path.dirname(executable), { recursive: true });
  await writeFile(executable, 'fixture');
  return executable;
}

function fakeBrowser(input: {
  version: string;
  visible?: boolean;
  text?: string;
  url?: string;
  html?: string;
  expectedContext?: Parameters<BrowserHandlePort['newPage']>[0];
  skipContextCheck?: boolean;
  navigationDelayMs?: number;
  onNavigate?: (emit: (event: string, value: unknown) => void) => void;
}): BrowserHandlePort {
  const listeners = new Map<string, (value: never) => void>();
  const page: BrowserPagePort = {
    on: (event, listener) => listeners.set(event, listener),
    goto: async () => {
      input.onNavigate?.((event, value) => listeners.get(event)?.(value as never));
      if (input.navigationDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, input.navigationDelayMs));
      }
    },
    locator: () => ({
      waitFor: () =>
        input.visible === false
          ? Promise.reject(new Error('locator was not visible'))
          : Promise.resolve(),
      textContent: () => Promise.resolve(input.text ?? 'Agent dashboard ready'),
    }),
    screenshot: () => Promise.resolve(Buffer.from('png-fixture')),
    content: () => Promise.resolve(input.html ?? '<main>Agent dashboard ready</main>'),
    url: () => input.url ?? 'http://127.0.0.1/dashboard',
  };
  return {
    version: () => input.version,
    newPage: (options) => {
      if (!input.skipContextCheck) {
        expect(options).toEqual(
          input.expectedContext ?? {
            viewport: { width: 390, height: 844 },
            deviceScaleFactor: 2,
          },
        );
      }
      return Promise.resolve(page);
    },
    close: () => Promise.resolve(),
  };
}

describe('browser journey', () => {
  it('compiles only the declared DSL and rejects unsafe or ambiguous input', () => {
    expect(
      compileBrowserJourney(
        journey([
          { type: 'navigate', url: 'https://example.test' },
          { type: 'screenshot', name: 'dashboard' },
        ]),
      ).actionIds,
    ).toEqual(['action-1', 'action-2']);
    expect(() =>
      compileBrowserJourney(journey([{ type: 'navigate', url: 'file:///secret' }])),
    ).toThrow(/HTTP or HTTPS/u);
    expect(() =>
      compileBrowserJourney(
        journey([
          { type: 'screenshot', name: 'same' },
          { type: 'screenshot', name: 'same' },
        ]),
      ),
    ).toThrow(/Duplicate screenshot/u);
  });

  it('runs navigation, waits, assertions and screenshots in a mobile viewport', async () => {
    const workspace = await temporaryDirectory('repoctopus-browser-journey-');
    cleanup.push(workspace);
    await prepareManagedBrowser(workspace);
    const metadata = await readManagedChromiumMetadata();
    const result = await new LocalBrowserAdapter(workspace, new FileArtifactStore(workspace), {
      launcher: () => Promise.resolve(fakeBrowser({ version: metadata.browserVersion })),
    }).run(
      journey([
        { type: 'collectConsole', levels: ['error'] },
        { type: 'collectFailedRequests', minimumStatus: 400 },
        { type: 'navigate', url: 'http://127.0.0.1/dashboard' },
        { type: 'waitFor', selector: '[data-testid="dashboard"]' },
        { type: 'assertVisible', selector: 'main' },
        { type: 'assertText', selector: 'main', text: 'dashboard', match: 'contains' },
        { type: 'assertUrl', url: '/dashboard', match: 'contains' },
        { type: 'screenshot', name: 'mobile-dashboard', fullPage: true },
      ]),
      'managed',
    );
    expect(result).toMatchObject({ status: 'passed', trust: 'verified' });
    expect(result.actions).toHaveLength(8);
    expect(result.artifacts).toEqual([
      expect.objectContaining({ artifactType: 'browser-screenshot:mobile-dashboard' }),
    ]);

    const desktop = await new LocalBrowserAdapter(workspace, new FileArtifactStore(workspace), {
      launcher: () =>
        Promise.resolve(
          fakeBrowser({
            version: metadata.browserVersion,
            expectedContext: {
              viewport: { width: 1440, height: 900 },
              deviceScaleFactor: 1,
            },
          }),
        ),
    }).run(
      journey([{ type: 'assertVisible', selector: 'main' }], { width: 1440, height: 900 }),
      'managed',
    );
    expect(desktop).toMatchObject({ status: 'passed', trust: 'verified' });
  });

  it('runs independent managed journeys concurrently with isolated browser instances', async () => {
    const workspace = await temporaryDirectory('repoctopus-browser-parallel-');
    cleanup.push(workspace);
    await prepareManagedBrowser(workspace);
    const metadata = await readManagedChromiumMetadata();
    let launches = 0;
    const adapter = new LocalBrowserAdapter(workspace, new FileArtifactStore(workspace), {
      launcher: () => {
        launches += 1;
        return Promise.resolve(
          fakeBrowser({
            version: metadata.browserVersion,
            navigationDelayMs: 50,
            skipContextCheck: true,
          }),
        );
      },
    });
    const [desktop, mobile] = await Promise.all([
      adapter.run(
        journey([{ type: 'navigate', url: 'http://127.0.0.1/dashboard' }], {
          width: 1440,
          height: 900,
        }),
        'managed',
      ),
      adapter.run(
        journey([{ type: 'navigate', url: 'http://127.0.0.1/dashboard' }]),
        'managed',
      ),
    ]);
    expect([desktop.status, mobile.status]).toEqual(['passed', 'passed']);
    expect(launches).toBe(2);
  });

  it('captures a failure screenshot and redacted bounded DOM when visibility fails', async () => {
    const workspace = await temporaryDirectory('repoctopus-browser-failure-');
    cleanup.push(workspace);
    await prepareManagedBrowser(workspace);
    const metadata = await readManagedChromiumMetadata();
    const secret = 'private-token-value';
    const store = new FileArtifactStore(workspace);
    const result = await new LocalBrowserAdapter(workspace, store, {
      sensitiveValues: [secret],
      launcher: () =>
        Promise.resolve(
          fakeBrowser({
            version: metadata.browserVersion,
            visible: false,
            html: `<main>${secret} ${workspace}</main>`,
          }),
        ),
    }).run(journey([{ type: 'assertVisible', selector: '#missing' }]), 'managed');
    expect(result.status).toBe('failed');
    expect(result.artifacts.map((artifact) => artifact.artifactType)).toEqual([
      'browser-failure-screenshot',
      'browser-failure-dom-summary',
    ]);
    const dom = result.artifacts.find(
      (artifact) => artifact.artifactType === 'browser-failure-dom-summary',
    )!;
    const contents = (await store.read(dom)).toString('utf8');
    expect(contents).not.toContain(secret);
    expect(contents).not.toContain(workspace);
  });

  it('downgrades a managed executable whose actual browser version does not match', async () => {
    const workspace = await temporaryDirectory('repoctopus-browser-mismatch-');
    cleanup.push(workspace);
    await prepareManagedBrowser(workspace);
    const result = await new LocalBrowserAdapter(workspace, new FileArtifactStore(workspace), {
      launcher: () => Promise.resolve(fakeBrowser({ version: '0.0.0.0' })),
    }).run(journey([{ type: 'assertUrl', url: '/dashboard', match: 'contains' }]), 'managed');
    expect(result).toMatchObject({
      status: 'incomplete',
      trust: null,
      browser: { trust: 'observed', browserVersion: '0.0.0.0' },
      findings: [expect.objectContaining({ code: 'browser-revision-mismatch' })],
    });
  });

  it('records console errors, page errors and failed network requests as failures', async () => {
    const workspace = await temporaryDirectory('repoctopus-browser-runtime-errors-');
    cleanup.push(workspace);
    await prepareManagedBrowser(workspace);
    const metadata = await readManagedChromiumMetadata();
    const result = await new LocalBrowserAdapter(workspace, new FileArtifactStore(workspace), {
      launcher: () =>
        Promise.resolve(
          fakeBrowser({
            version: metadata.browserVersion,
            onNavigate: (emit) => {
              emit('console', { type: () => 'error', text: () => 'uncaught console error' });
              emit('pageerror', new Error('page exploded'));
              emit('requestfailed', {
                url: () => 'http://127.0.0.1/api/offline',
                method: () => 'GET',
                failure: () => ({ errorText: 'connection refused' }),
              });
              emit('response', {
                url: () => 'http://127.0.0.1/api/failure',
                status: () => 500,
                request: () => ({ method: () => 'POST' }),
              });
            },
          }),
        ),
    }).run(
      journey([
        { type: 'collectConsole', levels: ['error'] },
        { type: 'collectFailedRequests', minimumStatus: 400 },
        { type: 'navigate', url: 'http://127.0.0.1/dashboard' },
      ]),
      'managed',
    );
    expect(result.status).toBe('failed');
    expect(result.console).toEqual([{ level: 'error', text: 'uncaught console error' }]);
    expect(result.pageErrors).toEqual(['page exploded']);
    expect(result.failedRequests).toHaveLength(2);
    expect(result.findings.map((finding) => finding.code)).toEqual([
      'browser-console-error',
      'browser-page-error',
      'browser-request-failed',
      'browser-request-failed',
    ]);
  });

  it('classifies a configured system Chrome or Edge as observed', async () => {
    const workspace = await temporaryDirectory('repoctopus-system-browser-');
    cleanup.push(workspace);
    const executable = path.join(workspace, 'msedge.exe');
    await writeFile(executable, 'fixture');
    const result = await resolveBrowserSource({
      workspace,
      source: 'system',
      configuredExecutablePath: executable,
    });
    expect(result).toMatchObject({
      status: 'ready',
      identity: {
        source: 'system',
        channel: 'msedge',
        trust: 'observed',
        executablePath: executable,
      },
    });
  });
});
