import type { ArtifactRef, EvidenceFinding, EvidenceTrust } from '../evidence/types.js';

export const BROWSER_JOURNEY_API_VERSION = 'repoctopus/v1alpha1' as const;

export type BrowserJourneyAction =
  | { type: 'navigate'; url: string; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' }
  | {
      type: 'waitFor';
      selector: string;
      state?: 'attached' | 'detached' | 'visible' | 'hidden';
      timeoutMs?: number;
    }
  | { type: 'assertVisible'; selector: string; timeoutMs?: number }
  | {
      type: 'assertText';
      selector: string;
      text: string;
      match?: 'exact' | 'contains';
      timeoutMs?: number;
    }
  | { type: 'assertUrl'; url: string; match?: 'exact' | 'contains'; timeoutMs?: number }
  | { type: 'screenshot'; name: string; fullPage?: boolean }
  | { type: 'collectConsole'; levels?: Array<'warning' | 'error'> }
  | { type: 'collectFailedRequests'; minimumStatus?: number };

export interface BrowserJourney {
  apiVersion: typeof BROWSER_JOURNEY_API_VERSION;
  kind: 'BrowserJourney';
  journeyId: string;
  viewport: { width: number; height: number; deviceScaleFactor?: number };
  timeoutMs: number;
  actions: BrowserJourneyAction[];
}

export interface CompiledBrowserJourney extends BrowserJourney {
  actionIds: string[];
}

export interface BrowserSourceIdentity {
  source: 'managed' | 'system';
  trust: EvidenceTrust;
  channel: 'chromium' | 'chrome' | 'msedge';
  executablePath: string;
  playwrightVersion: string;
  browserVersion: string;
  revision?: string;
}

export interface BrowserActionResult {
  actionId: string;
  type: BrowserJourneyAction['type'];
  status: 'passed' | 'failed';
  startedAt: string;
  completedAt: string;
  detail: string;
  artifact?: ArtifactRef;
}

export interface BrowserConsoleEntry {
  level: string;
  text: string;
}

export interface BrowserFailedRequest {
  url: string;
  method: string;
  status?: number;
  failure?: string;
}

export interface BrowserJourneyResult {
  journeyId: string;
  status: 'passed' | 'failed' | 'incomplete';
  trust: EvidenceTrust | null;
  browser: BrowserSourceIdentity | null;
  actions: BrowserActionResult[];
  artifacts: ArtifactRef[];
  console: BrowserConsoleEntry[];
  pageErrors: string[];
  failedRequests: BrowserFailedRequest[];
  findings: EvidenceFinding[];
  installCommand?: { executable: string; args: string[] };
}

export interface BrowserAdapter {
  run(journey: BrowserJourney, source: 'managed' | 'system'): Promise<BrowserJourneyResult>;
}

function positiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${field} must be positive`);
}

export function compileBrowserJourney(journey: BrowserJourney): CompiledBrowserJourney {
  if (journey.apiVersion !== BROWSER_JOURNEY_API_VERSION || journey.kind !== 'BrowserJourney') {
    throw new Error('Unsupported BrowserJourney envelope');
  }
  if (!journey.journeyId.trim()) throw new Error('journeyId is required');
  positiveInteger(journey.viewport.width, 'viewport.width');
  positiveInteger(journey.viewport.height, 'viewport.height');
  if (
    journey.viewport.deviceScaleFactor !== undefined &&
    (!(journey.viewport.deviceScaleFactor > 0) ||
      !Number.isFinite(journey.viewport.deviceScaleFactor))
  ) {
    throw new Error('viewport.deviceScaleFactor must be positive');
  }
  positiveInteger(journey.timeoutMs, 'timeoutMs');
  if (journey.actions.length === 0) throw new Error('BrowserJourney needs at least one action');
  const screenshotNames = new Set<string>();
  for (const [index, action] of journey.actions.entries()) {
    if ('timeoutMs' in action && action.timeoutMs !== undefined) {
      positiveInteger(action.timeoutMs, `actions[${index}].timeoutMs`);
    }
    if ('selector' in action && !action.selector.trim()) {
      throw new Error(`actions[${index}].selector is required`);
    }
    if (action.type === 'navigate') {
      const url = new URL(action.url);
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error(`actions[${index}].url must use HTTP or HTTPS`);
      }
    }
    if (action.type === 'screenshot') {
      if (!/^[a-z0-9][a-z0-9._-]*$/u.test(action.name)) {
        throw new Error(`actions[${index}].name is invalid`);
      }
      if (screenshotNames.has(action.name)) {
        throw new Error(`Duplicate screenshot name: ${action.name}`);
      }
      screenshotNames.add(action.name);
    }
  }
  return {
    ...structuredClone(journey),
    actionIds: journey.actions.map((_action, index) => `action-${index + 1}`),
  };
}
