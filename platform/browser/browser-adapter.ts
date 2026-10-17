import type { ArtifactStore } from '../../domains/evidence/ports.js';
import { redactEvidenceText } from '../../domains/evidence/redaction.js';
import type { ArtifactRef, EvidenceFinding } from '../../domains/evidence/types.js';
import {
  compileBrowserJourney,
  type BrowserAdapter,
  type BrowserActionResult,
  type BrowserConsoleEntry,
  type BrowserFailedRequest,
  type BrowserJourney,
  type BrowserJourneyResult,
  type BrowserSourceIdentity,
} from '../../domains/feedback/browser.js';
import { FileResourceLeaseManager } from '../runtime/resource-lease.js';
import { resolveBrowserSource } from './browser-source.js';

export interface ConsoleMessagePort {
  type(): string;
  text(): string;
}

export interface RequestPort {
  url(): string;
  method(): string;
  failure(): { errorText: string } | null;
}

export interface ResponsePort {
  url(): string;
  status(): number;
  request(): RequestPort;
}

export interface LocatorPort {
  waitFor(options: {
    state: 'attached' | 'detached' | 'visible' | 'hidden';
    timeout: number;
  }): Promise<void>;
  textContent(options: { timeout: number }): Promise<string | null>;
}

export interface BrowserPagePort {
  on(event: 'console', listener: (message: ConsoleMessagePort) => void): void;
  on(event: 'pageerror', listener: (error: Error) => void): void;
  on(event: 'requestfailed', listener: (request: RequestPort) => void): void;
  on(event: 'response', listener: (response: ResponsePort) => void): void;
  goto(
    url: string,
    options: { waitUntil: 'load' | 'domcontentloaded' | 'networkidle'; timeout: number },
  ): Promise<unknown>;
  locator(selector: string): LocatorPort;
  screenshot(options: { fullPage: boolean; type: 'png' }): Promise<Buffer>;
  content(): Promise<string>;
  url(): string;
}

export interface BrowserHandlePort {
  version(): string;
  newPage(options: {
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
  }): Promise<BrowserPagePort>;
  close(): Promise<void>;
}

export type BrowserLauncher = (input: {
  executablePath: string;
  headless: true;
}) => Promise<BrowserHandlePort>;

const defaultLauncher: BrowserLauncher = async (input) => {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch(input);
  return {
    version: () => browser.version(),
    newPage: async (options) => {
      const context = await browser.newContext(options);
      return context.newPage();
    },
    close: () => browser.close(),
  };
};

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForValue(
  read: () => Promise<boolean> | boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await read())) {
    if (Date.now() >= deadline) throw new Error(`Condition was not met within ${timeoutMs} ms`);
    await wait(Math.min(50, Math.max(1, deadline - Date.now())));
  }
}

function bounded(value: string, max = 4000): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function matches(actual: string, expected: string, match: 'exact' | 'contains'): boolean {
  return match === 'exact' ? actual === expected : actual.includes(expected);
}

export class LocalBrowserAdapter implements BrowserAdapter {
  private readonly leases: FileResourceLeaseManager;

  constructor(
    private readonly workspace: string,
    private readonly artifacts: ArtifactStore,
    private readonly options: {
      configuredExecutablePath?: string;
      sensitiveValues?: readonly string[];
      launcher?: BrowserLauncher;
    } = {},
  ) {
    this.leases = new FileResourceLeaseManager(workspace);
  }

  async run(
    journeyInput: BrowserJourney,
    source: 'managed' | 'system',
  ): Promise<BrowserJourneyResult> {
    const journey = compileBrowserJourney(journeyInput);
    const resolution = await resolveBrowserSource({
      workspace: this.workspace,
      source,
      ...(this.options.configuredExecutablePath
        ? { configuredExecutablePath: this.options.configuredExecutablePath }
        : {}),
    });
    if (resolution.status === 'incomplete') {
      return {
        journeyId: journey.journeyId,
        status: 'incomplete',
        trust: null,
        browser: null,
        actions: [],
        artifacts: [],
        console: [],
        pageErrors: [],
        failedRequests: [],
        findings: [{ code: 'browser-unavailable', severity: 'error', summary: resolution.reason }],
        ...(resolution.installCommand ? { installCommand: resolution.installCommand } : {}),
      };
    }

    const lease = await this.leases.acquire(
      `browser:${resolution.identity.source}:${resolution.identity.executablePath}`,
    );
    let browser: BrowserHandlePort | undefined;
    try {
      browser = await (this.options.launcher ?? defaultLauncher)({
        executablePath: resolution.identity.executablePath,
        headless: true,
      });
      const actualVersion = browser.version();
      const versionMatches =
        resolution.identity.source === 'system' ||
        actualVersion === resolution.identity.browserVersion;
      const identity: BrowserSourceIdentity = {
        ...resolution.identity,
        browserVersion: actualVersion,
        trust: versionMatches ? resolution.identity.trust : 'observed',
      };
      if (!versionMatches) {
        return {
          journeyId: journey.journeyId,
          status: 'incomplete',
          trust: null,
          browser: identity,
          actions: [],
          artifacts: [],
          console: [],
          pageErrors: [],
          failedRequests: [],
          findings: [
            {
              code: 'browser-revision-mismatch',
              severity: 'error',
              summary: `Expected Chromium ${resolution.identity.browserVersion}, received ${actualVersion}`,
            },
          ],
        };
      }
      return await this.executeJourney(journey, identity, browser);
    } finally {
      await browser?.close();
      await this.leases.release(lease);
    }
  }

  private async executeJourney(
    journey: ReturnType<typeof compileBrowserJourney>,
    identity: BrowserSourceIdentity,
    browser: BrowserHandlePort,
  ): Promise<BrowserJourneyResult> {
    const page = await browser.newPage({
      viewport: { width: journey.viewport.width, height: journey.viewport.height },
      deviceScaleFactor: journey.viewport.deviceScaleFactor ?? 1,
    });
    const actions: BrowserActionResult[] = [];
    const artifacts: ArtifactRef[] = [];
    const consoleEntries: BrowserConsoleEntry[] = [];
    const pageErrors: string[] = [];
    const failedRequests: BrowserFailedRequest[] = [];
    const findings: EvidenceFinding[] = [];
    let consoleLevels: Set<string> | null = null;
    let minimumFailedStatus: number | null = null;
    page.on('console', (message) => {
      if (consoleLevels?.has(message.type()) && consoleEntries.length < 200) {
        consoleEntries.push({ level: message.type(), text: bounded(message.text()) });
      }
    });
    page.on('pageerror', (error) => {
      if (pageErrors.length < 200) pageErrors.push(bounded(error.message));
    });
    page.on('requestfailed', (request) => {
      if (minimumFailedStatus !== null && failedRequests.length < 200) {
        failedRequests.push({
          url: bounded(request.url()),
          method: request.method(),
          failure: bounded(request.failure()?.errorText ?? 'request failed'),
        });
      }
    });
    page.on('response', (response) => {
      if (
        minimumFailedStatus !== null &&
        response.status() >= minimumFailedStatus &&
        failedRequests.length < 200
      ) {
        failedRequests.push({
          url: bounded(response.url()),
          method: response.request().method(),
          status: response.status(),
        });
      }
    });

    let failed = false;
    for (const [index, action] of journey.actions.entries()) {
      const startedAt = new Date().toISOString();
      let artifact: ArtifactRef | undefined;
      try {
        const timeout =
          'timeoutMs' in action ? (action.timeoutMs ?? journey.timeoutMs) : journey.timeoutMs;
        if (action.type === 'navigate') {
          await page.goto(action.url, {
            waitUntil: action.waitUntil ?? 'load',
            timeout,
          });
        } else if (action.type === 'waitFor') {
          await page.locator(action.selector).waitFor({
            state: action.state ?? 'visible',
            timeout,
          });
        } else if (action.type === 'assertVisible') {
          await page.locator(action.selector).waitFor({ state: 'visible', timeout });
        } else if (action.type === 'assertText') {
          await waitForValue(async () => {
            const actual = await page.locator(action.selector).textContent({ timeout });
            return matches(actual ?? '', action.text, action.match ?? 'contains');
          }, timeout);
        } else if (action.type === 'assertUrl') {
          await waitForValue(
            () => matches(page.url(), action.url, action.match ?? 'exact'),
            timeout,
          );
        } else if (action.type === 'screenshot') {
          artifact = await this.artifacts.put(
            await page.screenshot({ fullPage: action.fullPage ?? false, type: 'png' }),
            {
              artifactType: `browser-screenshot:${action.name}`,
              mediaType: 'image/png',
              redacted: false,
            },
          );
          artifacts.push(artifact);
        } else if (action.type === 'collectConsole') {
          consoleLevels = new Set(action.levels ?? ['warning', 'error']);
        } else {
          minimumFailedStatus = action.minimumStatus ?? 400;
        }
        actions.push({
          actionId: journey.actionIds[index]!,
          type: action.type,
          status: 'passed',
          startedAt,
          completedAt: new Date().toISOString(),
          detail: 'completed',
          ...(artifact ? { artifact } : {}),
        });
      } catch (error) {
        failed = true;
        const detail = bounded((error as Error).message);
        actions.push({
          actionId: journey.actionIds[index]!,
          type: action.type,
          status: 'failed',
          startedAt,
          completedAt: new Date().toISOString(),
          detail,
        });
        findings.push({ code: 'browser-action-failed', severity: 'error', summary: detail });
        const screenshot = await this.artifacts.put(
          await page.screenshot({ fullPage: false, type: 'png' }),
          {
            artifactType: 'browser-failure-screenshot',
            mediaType: 'image/png',
            redacted: false,
          },
        );
        const dom = redactEvidenceText(bounded(await page.content(), 64 * 1024), {
          absolutePaths: [this.workspace],
          ...(this.options.sensitiveValues
            ? { sensitiveValues: this.options.sensitiveValues }
            : {}),
        });
        const domArtifact = await this.artifacts.put(dom.contents, {
          artifactType: 'browser-failure-dom-summary',
          mediaType: 'text/html; charset=utf-8',
          redacted: true,
        });
        artifacts.push(screenshot, domArtifact);
        break;
      }
    }

    for (const entry of consoleEntries) {
      if (entry.level === 'error') {
        findings.push({ code: 'browser-console-error', severity: 'error', summary: entry.text });
      }
    }
    for (const message of pageErrors) {
      findings.push({ code: 'browser-page-error', severity: 'error', summary: message });
    }
    for (const request of failedRequests) {
      findings.push({
        code: 'browser-request-failed',
        severity: 'error',
        summary: `${request.method} ${request.url}${request.status ? ` returned ${request.status}` : ''}`,
      });
    }
    const hasRuntimeErrors = findings.some((finding) => finding.severity === 'error');
    return {
      journeyId: journey.journeyId,
      status: failed || hasRuntimeErrors ? 'failed' : 'passed',
      trust: identity.trust,
      browser: identity,
      actions,
      artifacts,
      console: consoleEntries,
      pageErrors,
      failedRequests,
      findings,
    };
  }
}
