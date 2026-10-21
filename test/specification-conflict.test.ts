import { describe, expect, it } from 'vitest';

import {
  requestSpecificationConflictDecision,
  resolveSpecificationConflict,
} from '../domains/specification/conflict.js';
import type { SpecificationConflict } from '../domains/specification/types.js';

const conflict: SpecificationConflict = {
  apiVersion: 'repoctopus.specification/v1alpha1',
  kind: 'SpecificationConflict',
  conflictId: 'conflict-toolbar-placement',
  changeId: 'dashboard-toolbar',
  summary: '规格要求顶部工具栏，设计图把工具栏放在侧边。',
  affectedStepIds: ['implement-dashboard', 'verify-dashboard'],
  sources: [
    {
      sourceId: 'spec-toolbar',
      sourceType: 'specification',
      reference: 'spec://dashboard/toolbar',
      summary: '工具栏位于页面顶部',
    },
    {
      sourceId: 'design-toolbar',
      sourceType: 'design',
      reference: 'design://dashboard/frame-12',
      summary: '工具栏位于页面侧边',
    },
  ],
};

describe('Specification authority conflict', () => {
  it('pauses only affected steps and provides no implicit default', () => {
    const request = requestSpecificationConflictDecision(conflict, 'request-conflict');
    expect(request.pausedStepIds).toEqual(['implement-dashboard', 'verify-dashboard']);
    expect(request.options).toHaveLength(2);
    expect(request).not.toHaveProperty('defaultOptionId');
  });

  it('requires the chosen authority to be updated before resolving', () => {
    const request = requestSpecificationConflictDecision(conflict, 'request-conflict');
    expect(() =>
      resolveSpecificationConflict({
        request,
        response: {
          apiVersion: 'repoctopus/v1alpha1',
          kind: 'HumanDecisionResponse',
          requestId: request.requestId,
          snapshotDigest: request.snapshotDigest,
          selectedOptionId: 'select:design-toolbar',
          authorityUpdateDigest: 'missing' as `sha256:${string}`,
        },
        timestamp: '2026-10-20T00:00:00.000Z',
      }),
    ).toThrow('authority update digest');

    expect(
      resolveSpecificationConflict({
        request,
        response: {
          apiVersion: 'repoctopus/v1alpha1',
          kind: 'HumanDecisionResponse',
          requestId: request.requestId,
          snapshotDigest: request.snapshotDigest,
          selectedOptionId: 'select:design-toolbar',
          authorityUpdateDigest: `sha256:${'c'.repeat(64)}`,
        },
        timestamp: '2026-10-20T00:00:00.000Z',
      }),
    ).toEqual({
      conflictId: 'conflict-toolbar-placement',
      selectedSourceId: 'design-toolbar',
      authorityUpdateDigest: `sha256:${'c'.repeat(64)}`,
      resolvedAt: '2026-10-20T00:00:00.000Z',
    });
  });
});
