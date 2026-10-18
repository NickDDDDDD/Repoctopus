import { describe, expect, it } from 'vitest';

import type { EvidenceExecutionPlan } from '../domains/feedback/profile.js';
import {
  pauseForVisualRequirementsConflicts,
  recordRequirementsConflictDecision,
} from '../domains/feedback/requirements-conflict.js';
import type { VisualInspectionResponse } from '../domains/feedback/visual.js';

const plan: EvidenceExecutionPlan = {
  schemaVersion: 1,
  profileId: 'verify',
  configDigest: 'config',
  order: ['browser', 'backend', 'visual', 'report'],
  nodes: [
    {
      id: 'browser',
      type: 'command',
      repository: 'front',
      repositoryPath: 'front',
      dependsOn: [],
      required: true,
      executable: 'browser',
      args: [],
      timeoutMs: 1,
      cache: false,
    },
    {
      id: 'backend',
      type: 'command',
      repository: 'backend',
      repositoryPath: 'backend',
      dependsOn: [],
      required: true,
      executable: 'test',
      args: [],
      timeoutMs: 1,
      cache: false,
    },
    {
      id: 'visual',
      type: 'command',
      repository: 'front',
      repositoryPath: 'front',
      dependsOn: ['browser'],
      required: true,
      executable: 'visual',
      args: [],
      timeoutMs: 1,
      cache: false,
    },
    {
      id: 'report',
      type: 'command',
      repository: 'front',
      repositoryPath: 'front',
      dependsOn: ['visual'],
      required: true,
      executable: 'report',
      args: [],
      timeoutMs: 1,
      cache: false,
    },
  ],
};

function response(withConflict: boolean): VisualInspectionResponse {
  return {
    apiVersion: 'repoctopus/v1alpha1',
    kind: 'VisualInspectionResponse',
    responseId: 'response-1',
    requestId: 'request-1',
    screenshotSha256: 'a'.repeat(64),
    findings: withConflict
      ? [
          {
            findingId: 'conflict-1',
            severity: 'error',
            summary: 'Page follows the design but violates the specification',
            evidenceRefs: ['a'.repeat(64)],
            conflict: {
              conflictId: 'authority-conflict-1',
              summary: 'Save action location differs',
              impact: 'The implementation cannot satisfy both sources',
              sources: [
                {
                  sourceType: 'openspec',
                  sourceRef: 'openspec/specs/editor/spec.md#save',
                  requirement: 'Save action appears in the toolbar',
                },
                {
                  sourceType: 'design',
                  sourceRef: 'figma://editor?node=save-footer',
                  requirement: 'Save action appears in the footer',
                },
              ],
            },
          },
        ]
      : [],
  };
}

describe('requirements conflict decision', () => {
  it('pauses only the conflicting node and its dependents without choosing a source', () => {
    const pause = pauseForVisualRequirementsConflicts({
      plan,
      changeId: 'capture-implementation-feedback',
      nodeId: 'visual',
      response: response(true),
    });
    expect(pause.status).toBe('awaiting_human');
    expect(pause.pausedNodeIds).toEqual(['visual', 'report']);
    expect(pause.pausedNodeIds).not.toContain('backend');
    expect(pause.decisionRequests).toEqual([
      expect.objectContaining({
        kind: 'HumanDecisionRequest',
        decisionType: 'requirements-conflict',
        nodeId: 'visual',
        options: [
          expect.objectContaining({ sourceRef: 'openspec/specs/editor/spec.md#save' }),
          expect.objectContaining({ sourceRef: 'figma://editor?node=save-footer' }),
        ],
      }),
    ]);
    expect(pause.decisionRequests[0]).not.toHaveProperty('selectedOptionId');
  });

  it('continues when visual inspection contains no authority conflict', () => {
    expect(
      pauseForVisualRequirementsConflicts({
        plan,
        changeId: 'capture-implementation-feedback',
        nodeId: 'visual',
        response: response(false),
      }),
    ).toEqual({ status: 'completed', decisionRequests: [], pausedNodeIds: [] });
  });

  it('accepts only an authenticated response bound to the pending snapshot', () => {
    const pause = pauseForVisualRequirementsConflicts({
      plan,
      changeId: 'capture-implementation-feedback',
      nodeId: 'visual',
      response: response(true),
    });
    const request = pause.decisionRequests[0]!;
    const decision = {
      apiVersion: 'repoctopus/v1alpha1' as const,
      kind: 'HumanDecisionResponse' as const,
      requestId: request.requestId,
      snapshotDigest: request.snapshotDigest,
      selectedOptionId: 'source-1',
    };
    expect(() =>
      recordRequirementsConflictDecision({
        request,
        response: decision,
        actor: { actorId: 'agent', source: 'ide', authenticated: false },
        timestamp: '2026-10-18T00:00:00.000Z',
      }),
    ).toThrow(/not trusted/u);
    expect(
      recordRequirementsConflictDecision({
        request,
        response: decision,
        actor: { actorId: 'user-1', source: 'ide', authenticated: true },
        timestamp: '2026-10-18T00:00:00.000Z',
      }),
    ).toMatchObject({
      selectedOptionId: 'source-1',
      selectedSourceRef: 'openspec/specs/editor/spec.md#save',
      actorId: 'user-1',
    });
  });
});
