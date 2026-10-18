import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  collectVisualInspection,
  conflictDecisionsFromVisualResponse,
  createVisualInspectionRequest,
  type VisualInspectionResponse,
} from '../domains/feedback/visual.js';
import { FileExchangeVisualInspectionAdapter } from '../platform/feedback/file-exchange-visual-adapter.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

const screenshot = {
  apiVersion: 'repoctopus/v1alpha1' as const,
  kind: 'ArtifactRef' as const,
  sha256: 'a'.repeat(64),
  size: 100,
  mediaType: 'image/png',
  artifactType: 'browser-screenshot',
  redacted: true,
};

describe('visual inspection protocol', () => {
  it('returns incomplete when no visual adapter is available', async () => {
    const request = createVisualInspectionRequest({
      requestId: 'request-1',
      screenshot,
      viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
      page: { url: 'http://127.0.0.1/' },
      criteria: [{ id: 'layout', text: 'Main panel is visible' }],
      designReferences: [],
    });
    await expect(collectVisualInspection(request)).resolves.toMatchObject({
      status: 'incomplete',
      response: null,
    });
  });

  it('rejects a stale response that references another screenshot', async () => {
    const request = createVisualInspectionRequest({
      requestId: 'request-1',
      screenshot,
      viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
      page: { url: 'http://127.0.0.1/' },
      criteria: [{ id: 'layout', text: 'Main panel is visible' }],
      designReferences: [],
    });
    await expect(
      collectVisualInspection(request, {
        inspect: () =>
          Promise.resolve({
            apiVersion: 'repoctopus/v1alpha1',
            kind: 'VisualInspectionResponse',
            responseId: 'response-1',
            requestId: request.requestId,
            screenshotSha256: 'b'.repeat(64),
            findings: [],
          }),
      }),
    ).rejects.toThrow(/screenshot does not match/i);
  });

  it('exchanges a request and request-bound response through a local directory', async () => {
    const workspace = await temporaryDirectory('repoctopus-visual-exchange-');
    cleanup.push(workspace);
    const request = createVisualInspectionRequest({
      requestId: 'request-file-exchange',
      screenshot,
      viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
      page: { url: 'http://127.0.0.1/' },
      criteria: [{ id: 'layout', text: 'Main panel is visible' }],
      designReferences: [],
    });
    const adapter = new FileExchangeVisualInspectionAdapter(workspace, {
      exchangeDirectory: '.repoctopus/visual-exchange',
      responseTimeoutMs: 2000,
      pollIntervalMs: 10,
    });
    const pending = collectVisualInspection(request, adapter);
    const requestFile = path.join(
      workspace,
      '.repoctopus',
      'visual-exchange',
      'requests',
      `${request.requestId}.json`,
    );
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        await readFile(requestFile, 'utf8');
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    const responseDirectory = path.join(workspace, '.repoctopus', 'visual-exchange', 'responses');
    await mkdir(responseDirectory, { recursive: true });
    await writeFile(
      path.join(responseDirectory, `${request.requestId}.json`),
      JSON.stringify({
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'VisualInspectionResponse',
        responseId: 'response-file-exchange',
        requestId: request.requestId,
        screenshotSha256: screenshot.sha256,
        findings: [],
      }),
    );
    await expect(pending).resolves.toMatchObject({
      status: 'completed',
      response: { responseId: 'response-file-exchange' },
    });
  });

  it('returns incomplete when a local exchange receives no response before timeout', async () => {
    const workspace = await temporaryDirectory('repoctopus-visual-timeout-');
    cleanup.push(workspace);
    const request = createVisualInspectionRequest({
      requestId: 'request-timeout',
      screenshot,
      viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
      page: { url: 'http://127.0.0.1/' },
      criteria: [{ id: 'layout', text: 'Main panel is visible' }],
      designReferences: [],
    });
    const adapter = new FileExchangeVisualInspectionAdapter(workspace, {
      exchangeDirectory: '.repoctopus/visual-exchange',
      responseTimeoutMs: 20,
      pollIntervalMs: 5,
    });
    await expect(collectVisualInspection(request, adapter)).resolves.toMatchObject({
      status: 'incomplete',
      response: null,
    });
  });

  it('turns a Spec and design conflict into a Human Decision request', () => {
    const response: VisualInspectionResponse = {
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'VisualInspectionResponse',
      responseId: 'response-1',
      requestId: 'request-1',
      screenshotSha256: screenshot.sha256,
      findings: [
        {
          findingId: 'conflict-1',
          severity: 'error',
          summary: 'Button placement conflicts',
          evidenceRefs: [screenshot.sha256],
          conflict: {
            conflictId: 'authority-conflict-1',
            summary: 'The Spec and design require different actions',
            impact: 'The affected interaction cannot be verified',
            sources: [
              {
                sourceType: 'openspec',
                sourceRef: 'openspec/specs/example/spec.md',
                requirement: 'Show the action in the toolbar',
              },
              {
                sourceType: 'design',
                sourceRef: 'design://screen/action',
                requirement: 'Show the action in the footer',
              },
            ],
          },
        },
      ],
    };
    const requests = conflictDecisionsFromVisualResponse({
      changeId: 'example-change',
      nodeId: 'visual-check',
      response,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      kind: 'HumanDecisionRequest',
      decisionType: 'requirements-conflict',
      changeId: 'example-change',
      nodeId: 'visual-check',
      options: [
        { sourceRef: 'openspec/specs/example/spec.md' },
        { sourceRef: 'design://screen/action' },
      ],
    });
    expect(requests[0]?.snapshotDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });
});
