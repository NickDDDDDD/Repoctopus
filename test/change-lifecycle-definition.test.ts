import { describe, expect, it } from 'vitest';

import {
  BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
  assertChangeLifecycleDefinition,
  createChangeLifecycleSnapshot,
  digestChangeLifecycleDefinition,
  normalizeChangeLifecycleDefinition,
  prepareChangeLifecycleDefinition,
  recoverChangeLifecycleSnapshot,
} from '../domains/change-lifecycle/definition.js';
import {
  CHANGE_PHASES,
  type ChangeLifecycleDefinition,
  type ChangeRunIdentity,
} from '../domains/change-lifecycle/transition.js';

const identity: ChangeRunIdentity = {
  workspaceId: 'repoctopus',
  changeId: 'establish-change-lifecycle',
  generation: 1,
  runId: 'change-establish-change-lifecycle-1',
};

function copyDefinition(): ChangeLifecycleDefinition {
  return structuredClone(BUILTIN_CHANGE_LIFECYCLE_DEFINITION);
}

describe('Change lifecycle definition', () => {
  it('validates and normalizes the built-in five-stage state machine', () => {
    expect(() =>
      assertChangeLifecycleDefinition(BUILTIN_CHANGE_LIFECYCLE_DEFINITION),
    ).not.toThrow();

    const normalized = normalizeChangeLifecycleDefinition(BUILTIN_CHANGE_LIFECYCLE_DEFINITION);
    expect(normalized.phases.map((phase) => phase.phase)).toEqual(CHANGE_PHASES);
    expect(normalized.transitions.map((transition) => transition.id)).toEqual(
      [...normalized.transitions.map((transition) => transition.id)].sort(),
    );
    for (const phase of normalized.phases) {
      expect(phase.workKinds).toEqual([...phase.workKinds].sort());
      expect(phase.requiredValidatorProfiles).toEqual([...phase.requiredValidatorProfiles].sort());
      expect(phase.extensionCheckpoints).toEqual([...phase.extensionCheckpoints].sort());
    }
  });

  it('fixes definition identity, version, and normalized content digest at Run creation', () => {
    const prepared = prepareChangeLifecycleDefinition();
    const snapshot = createChangeLifecycleSnapshot({ identity });

    expect(snapshot).toMatchObject({
      definition: {
        id: BUILTIN_CHANGE_LIFECYCLE_DEFINITION.id,
        version: BUILTIN_CHANGE_LIFECYCLE_DEFINITION.version,
        digest: prepared.snapshot.digest,
      },
      revision: 0,
      phase: 'open',
      status: 'running',
      currentWork: null,
      waitCondition: null,
      blocker: null,
    });
    expect(snapshot.definition.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it('stops an active Run when content drifts under the same definition version', () => {
    const persisted = createChangeLifecycleSnapshot({ identity });
    const drifted = copyDefinition();
    const transition = drifted.transitions.find((candidate) => candidate.id === 'design.approved')!;
    transition.trigger = 'changed-without-version-bump';

    const recovered = recoverChangeLifecycleSnapshot({
      persisted,
      currentDefinition: drifted,
    });

    expect(recovered).toMatchObject({
      compatibility: 'migration_required',
      changed: true,
      expected: { id: drifted.id, version: drifted.version, digest: persisted.definition.digest },
      current: { id: drifted.id, version: drifted.version },
      snapshot: {
        revision: 1,
        phase: 'open',
        status: 'migration_required',
        currentWork: null,
        waitCondition: null,
        blocker: {
          code: 'change-lifecycle.definition-drift',
          sinceRevision: 1,
        },
      },
    });
    expect(recovered.current.digest).not.toBe(recovered.expected.digest);
    expect(recovered.snapshot.definition).toEqual(persisted.definition);
  });

  it('ignores object key order and set-like array order when calculating compatibility', () => {
    const original = copyDefinition();
    const reordered: ChangeLifecycleDefinition = {
      transitions: [...original.transitions].reverse().map((transition) => ({
        trigger: transition.trigger,
        to: { status: transition.to.status, phase: transition.to.phase },
        from: {
          statuses: [...transition.from.statuses].reverse(),
          phase: transition.from.phase,
        },
        kind: transition.kind,
        id: transition.id,
        ...(transition.requiredValidatorProfile
          ? { requiredValidatorProfile: transition.requiredValidatorProfile }
          : {}),
      })),
      phases: original.phases.map((phase) => ({
        extensionCheckpoints: [...phase.extensionCheckpoints].reverse(),
        requiredValidatorProfiles: [...phase.requiredValidatorProfiles].reverse(),
        workKinds: [...phase.workKinds].reverse(),
        phase: phase.phase,
      })),
      version: original.version,
      id: original.id,
      schemaVersion: 1,
    };
    const persisted = createChangeLifecycleSnapshot({ identity, definition: original });

    expect(digestChangeLifecycleDefinition(reordered)).toBe(
      digestChangeLifecycleDefinition(original),
    );
    expect(
      recoverChangeLifecycleSnapshot({ persisted, currentDefinition: reordered }),
    ).toMatchObject({ compatibility: 'same', changed: false, snapshot: persisted });
  });

  it('rejects phase reordering and transitions that bypass a protected phase', () => {
    const reordered = copyDefinition();
    reordered.phases = [reordered.phases[1]!, reordered.phases[0]!, ...reordered.phases.slice(2)];
    expect(() => assertChangeLifecycleDefinition(reordered)).toThrow(
      /must be exactly open -> design -> build -> verify -> archive/u,
    );

    const bypass = copyDefinition();
    bypass.transitions.find((transition) => transition.id === 'open.intake-ready')!.to.phase =
      'build';
    expect(() => assertChangeLifecycleDefinition(bypass)).toThrow(/bypasses a protected phase/u);
  });

  it('rejects ambiguous transition identities and validators outside the source phase', () => {
    const duplicate = copyDefinition();
    duplicate.transitions = [...duplicate.transitions, structuredClone(duplicate.transitions[0]!)];
    expect(() => assertChangeLifecycleDefinition(duplicate)).toThrow(/id is duplicated/u);

    const wrongValidator = copyDefinition();
    wrongValidator.transitions.find(
      (transition) => transition.id === 'open.intake-ready',
    )!.requiredValidatorProfile = 'verify.evidence-gate';
    expect(() => assertChangeLifecycleDefinition(wrongValidator)).toThrow(
      /references validator outside open/u,
    );

    const unknownTargetStatus = copyDefinition();
    unknownTargetStatus.transitions.find(
      (transition) => transition.id === 'design.revision-requested',
    )!.to.status = 'unknown' as 'running';
    expect(() => assertChangeLifecycleDefinition(unknownTargetStatus)).toThrow(
      /targets unknown status/u,
    );
  });

  it('makes repeated recovery from the same drift idempotent', () => {
    const persisted = createChangeLifecycleSnapshot({ identity });
    const drifted = copyDefinition();
    drifted.transitions.find((transition) => transition.id === 'verify.failed')!.trigger =
      'new-failure-contract';

    const first = recoverChangeLifecycleSnapshot({ persisted, currentDefinition: drifted });
    const second = recoverChangeLifecycleSnapshot({
      persisted: first.snapshot,
      currentDefinition: drifted,
    });

    expect(first.changed).toBe(true);
    expect(second).toMatchObject({
      compatibility: 'migration_required',
      changed: false,
      snapshot: first.snapshot,
    });
  });
});
