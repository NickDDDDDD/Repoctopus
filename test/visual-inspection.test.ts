import { describe, expect, it } from 'vitest';

import {
  collectVisualInspection,
  conflictDecisionsFromVisualResponse,
  createVisualInspectionRequest,
  type VisualInspectionResponse,
} from '../domains/feedback/visual.js';

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
