import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  decisionInteraction,
  parseLifecycleHumanDecisionResponse,
} from '../domains/change-lifecycle/human-decision.js';
import { readLifecycleDecisionResponse } from '../app/cli/lifecycle-decision.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));
const response = () => ({
  apiVersion: 'repoctopus/v1alpha1',
  kind: 'LifecycleHumanDecisionResponse',
  runId: 'run-a',
  phase: 'open',
  decisionKind: 'specification-open',
  requestId: 'request-a',
  proposalHash: `sha256:${'a'.repeat(64)}`,
  decision: 'approve',
  isolation: 'branch',
  interaction: {
    channel: 'native',
    authorization: 'user-response',
    reference: 'opaque-private-user-reply',
  },
});

describe('Human Decision response boundary', () => {
  it.each([
    ['specification-open', 'open', true],
    ['specification-design', 'design', false],
    ['workspace-intent-revision', 'open', true],
    ['build-plan-risk', 'build', false],
  ])('validates %s and its conditional isolation', (decisionKind, phase, needsIsolation) => {
    const base: Record<string, unknown> = response();
    delete base.isolation;
    const value = {
      ...base,
      decisionKind,
      phase,
      ...(needsIsolation ? { isolation: 'branch' } : {}),
    };
    expect(parseLifecycleHumanDecisionResponse(value)).toMatchObject({ decisionKind, phase });
    if (needsIsolation)
      expect(() => parseLifecycleHumanDecisionResponse({ ...value, isolation: undefined })).toThrow(
        /isolation/,
      );
    else
      expect(() => parseLifecycleHumanDecisionResponse({ ...value, isolation: 'branch' })).toThrow(
        /not applicable/,
      );
    const nonApprove: Record<string, unknown> = { ...value };
    delete nonApprove.isolation;
    expect(
      parseLifecycleHumanDecisionResponse({ ...nonApprove, decision: 'revise' }).decision,
    ).toBe('revise');
  });
  it.each(['actorId', 'source', 'authenticated', 'targetPhase', 'continuation'])(
    'rejects caller-controlled %s',
    (key) => {
      expect(() => parseLifecycleHumanDecisionResponse({ ...response(), [key]: true })).toThrow(
        /unknown field/,
      );
    },
  );
  it.each([
    { decision: null },
    { decision: 'default' },
    { phase: 'design' },
    { isolation: 'temporary' },
    { interaction: { channel: 'native', authorization: 'user-response', reference: '' } },
    { interaction: { channel: 'native', authorization: 'assumed', reference: 'x' } },
    {
      interaction: {
        channel: 'native',
        authorization: 'user-response',
        reference: 'x',
        authenticated: true,
      },
    },
    { interaction: { channel: ['native'], authorization: ['user-response'], reference: 'x' } },
    { comment: 'x'.repeat(4097) },
  ])('rejects unfilled or invalid response %j', (patch) => {
    expect(() => parseLifecycleHumanDecisionResponse({ ...response(), ...patch })).toThrow();
  });
  it('records bounded provenance without persisting the private answer reference', () => {
    const provenance = decisionInteraction(parseLifecycleHumanDecisionResponse(response()));
    expect(provenance).toMatchObject({ channel: 'native', authorization: 'user-response' });
    expect(provenance.referenceDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(provenance)).not.toContain('opaque-private');
  });
  it('accepts conversation delegation but never an unanswered template', () => {
    const value = response();
    expect(
      parseLifecycleHumanDecisionResponse({
        ...value,
        interaction: {
          channel: 'conversation',
          authorization: 'delegated',
          reference: 'explicit-current-proposal-delegation',
        },
      }).interaction.authorization,
    ).toBe('delegated');
    expect(() => parseLifecycleHumanDecisionResponse({ ...value, decision: null })).toThrow();
  });
  it('bounds file reads and rejects oversized responses before parsing', async () => {
    const root = await temporaryDirectory('repoctopus-decision-file-');
    cleanup.push(root);
    const file = path.join(root, 'response.json');
    await writeFile(file, JSON.stringify(response()));
    expect((await readLifecycleDecisionResponse(file)).runId).toBe('run-a');
    await writeFile(file, ' '.repeat(64 * 1024 + 1));
    await expect(readLifecycleDecisionResponse(file)).rejects.toThrow(/64 KiB/);
  });
});
