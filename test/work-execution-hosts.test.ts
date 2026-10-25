import { Context } from '@deepseek-ai/cordis';
import { describe, expect, it } from 'vitest';

import type { WorkExecutionHost, WorkExecutionPacket } from '../domains/work-execution/types.js';
import { WorkExecutionHosts, WorkExecutionSessions } from '../services/work-execution-hosts.js';

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;

function packet(capabilities: readonly string[] = ['repository.write']): WorkExecutionPacket {
  return {
    schemaVersion: 1,
    identity: {
      schemaVersion: 1,
      packetId: digest('a'),
      packetDigest: digest('b'),
      contextDigest: digest('c'),
    },
    claim: {
      intentId: 'intent-1',
      runId: 'run-1',
      workId: 'work-1',
      attempt: 1,
      claimToken: digest('d'),
      inputDigest: digest('e'),
      compositionDigest: digest('f'),
    },
    work: {
      schemaVersion: 1,
      workId: 'work-1',
      phase: 'build',
      kind: 'task.implement',
      augmentationSkills: [],
      methodProfile: {
        id: 'test',
        version: '1.0.0',
        digest: digest('g'),
        sourceDigests: [],
        ruleIds: [],
      },
      capabilities,
      sideEffectClass: 'repository-write',
      writeScopes: [],
      inputDigest: digest('e'),
      outputContract: { artifactKinds: [], trackerPublish: false },
      validatorProfile: { id: 'build.task-valid', version: '1.0.0', digest: digest('h') },
      authorizationSource: {
        kind: 'lifecycle-definition',
        definitionId: 'repoctopus-change',
        definitionVersion: '2.0.0',
      },
      checkpoint: 'build.before-task',
    },
    context: {
      schemaVersion: 1,
      workId: 'work-1',
      layers: [],
      digest: digest('c'),
    },
    hostRequirement: {
      schemaVersion: 1,
      actionKind: 'agent',
      capabilities,
      sideEffectClass: 'repository-write',
    },
  };
}

function host(id: string, capabilities: readonly string[]): WorkExecutionHost {
  return {
    identity: {
      schemaVersion: 1,
      id,
      version: '1.0.0',
      codeDigest: digest(id === 'host-a' ? '1' : '2'),
      capabilities,
      actionKinds: ['agent'],
      reconcile: false,
    },
    preflight: () => Promise.resolve({ accepted: true }),
    invoke: (_packet, session) =>
      Promise.resolve({
        schemaVersion: 1,
        invocationId: session.invocationId,
        hostId: id,
        packetDigest: session.packetDigest,
        status: 'succeeded',
        summary: 'done',
        consumedLayerDigests: [],
        completedAt: '2026-10-25T00:00:00.000Z',
      }),
  };
}

describe('Work Execution Hosts', () => {
  it('selects exactly one capable Host and records stable composition identity', async () => {
    const context = new Context();
    const registry = new WorkExecutionHosts(context);
    const dispose = registry.register(host('host-a', ['repository.write', 'process.execute']));
    expect(registry.select(packet()).identity.id).toBe('host-a');
    const snapshot = registry.snapshot();
    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      hosts: [{ id: 'host-a' }],
    });
    expect(snapshot.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    dispose();
    expect(() => registry.select(packet())).toThrow(/No Work Execution Host/u);
    await context.fiber.dispose();
  });

  it('fails closed for capability gaps and ambiguous Hosts', async () => {
    const context = new Context();
    const registry = new WorkExecutionHosts(context);
    registry.register(host('host-a', ['repository.read']));
    expect(() => registry.select(packet())).toThrow(/No Work Execution Host/u);
    registry.register(host('host-b', ['repository.write']));
    expect(registry.select(packet()).identity.id).toBe('host-b');
    registry.register(host('host-c', ['repository.write']));
    expect(() => registry.select(packet())).toThrow(/ambiguous/u);
    await context.fiber.dispose();
  });
});

describe('Work Execution Sessions', () => {
  it('isolates concurrent Runs and expires authorization immediately on close', async () => {
    const context = new Context();
    const sessions = new WorkExecutionSessions(context);
    const first = sessions.open({
      runId: 'run-a',
      workId: 'work',
      attempt: 1,
      invocationId: 'invoke-a',
      packetDigest: digest('a'),
      hostId: 'host-a',
    });
    const second = sessions.open({
      runId: 'run-b',
      workId: 'work',
      attempt: 1,
      invocationId: 'invoke-b',
      packetDigest: digest('b'),
      hostId: 'host-b',
    });
    expect(first.sessionId).not.toBe(second.sessionId);
    expect(sessions.require(first, 'host-a')).toEqual(first);
    expect(sessions.isActive(first.invocationId)).toBe(true);
    expect(() => sessions.require(first, 'host-b')).toThrow(/another Host/u);
    sessions.close(first.sessionId);
    expect(() => sessions.require(first, 'host-a')).toThrow(/expired/u);
    expect(sessions.isActive(first.invocationId)).toBe(false);
    expect(sessions.require(second, 'host-b')).toEqual(second);
    await context.fiber.dispose();
  });
});
