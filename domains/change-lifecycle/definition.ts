import { createHash } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';
import {
  CHANGE_PHASES,
  CHANGE_RUN_STATUSES,
  assertChangeLifecycleSnapshot,
  type ChangeLifecycleDefinition,
  type ChangeLifecycleDefinitionSnapshot,
  type ChangeLifecyclePhaseDefinition,
  type ChangeLifecycleSnapshot,
  type ChangeLifecycleTransitionDefinition,
  type ChangePhase,
  type ChangeRunIdentity,
  type RunStatus,
} from './transition.js';
import { BUILTIN_METHOD_PROFILE_REGISTRY } from './method-profile.js';

const phaseOrder = new Map<ChangePhase, number>(
  CHANGE_PHASES.map((phase, index) => [phase, index]),
);
const statusOrder = new Map<RunStatus, number>(
  CHANGE_RUN_STATUSES.map((status, index) => [status, index]),
);
const declaredStatuses = new Set<string>(CHANGE_RUN_STATUSES);
const declaredTransitionKinds = new Set<string>(['advance', 'self', 'fallback', 'complete']);
const terminalStatuses = new Set<RunStatus>(['completed', 'failed', 'migration_required']);
const sideEffectClasses = new Set([
  'none',
  'specification-write',
  'repository-write',
  'process',
  'git-publish',
  'platform-mutation',
]);
const behaviorReferenceOnlySkills = new Set(['to-spec', 'to-tickets']);

function profileDigest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function validatorProfile(id: string) {
  const stable = { id, version: '1.0.0' } as const;
  return { ...stable, digest: profileDigest(stable) };
}

export const BUILTIN_CHANGE_LIFECYCLE_DEFINITION: ChangeLifecycleDefinition = {
  schemaVersion: 1,
  id: 'repoctopus-change',
  version: '1.1.0',
  phases: [
    {
      phase: 'open',
      workKinds: ['change.intake'],
      requiredValidatorProfiles: ['open.intake-ready'],
      extensionCheckpoints: ['open.after-intake'],
    },
    {
      phase: 'design',
      workKinds: ['specification.decision', 'specification.plan'],
      requiredValidatorProfiles: ['design.approval-valid', 'design.artifacts-valid'],
      extensionCheckpoints: ['design.after-approval', 'design.after-validation'],
    },
    {
      phase: 'build',
      workKinds: ['task.implement'],
      requiredValidatorProfiles: ['build.plan-current', 'build.task-valid'],
      extensionCheckpoints: ['build.after-task', 'build.before-task'],
    },
    {
      phase: 'verify',
      workKinds: ['evidence.verify'],
      requiredValidatorProfiles: ['verify.evidence-gate'],
      extensionCheckpoints: ['verify.after-gate', 'verify.before-gate'],
    },
    {
      phase: 'archive',
      workKinds: ['delivery.await-merge', 'delivery.prepare', 'specification.archive'],
      requiredValidatorProfiles: ['archive.delivery-ready', 'archive.specification-closed'],
      extensionCheckpoints: [
        'archive.after-merge',
        'archive.before-close',
        'archive.before-publish',
      ],
    },
  ],
  works: [
    {
      kind: 'change.intake',
      phase: 'open',
      augmentationSkills: [],
      methodProfile: BUILTIN_METHOD_PROFILE_REGISTRY.snapshot('repoctopus.open', '1.0.0'),
      capabilities: ['repository.read', 'specification.read'],
      sideEffectClass: 'none',
      writeScopes: [],
      outputContract: { artifactKinds: [], trackerPublish: false },
      validatorProfile: validatorProfile('open.intake-ready'),
      checkpoint: 'open.after-intake',
    },
    {
      kind: 'specification.decision',
      phase: 'design',
      augmentationSkills: [],
      methodProfile: BUILTIN_METHOD_PROFILE_REGISTRY.snapshot('repoctopus.design', '1.0.0'),
      capabilities: ['repository.read', 'specification.read'],
      sideEffectClass: 'none',
      writeScopes: [],
      outputContract: {
        artifactKinds: ['proposal', 'delta-specs', 'design', 'tasks'],
        trackerPublish: false,
      },
      validatorProfile: validatorProfile('design.approval-valid'),
      checkpoint: 'design.after-approval',
    },
    {
      kind: 'specification.plan',
      phase: 'design',
      augmentationSkills: [{ name: 'codebase-design' }],
      methodProfile: BUILTIN_METHOD_PROFILE_REGISTRY.snapshot('repoctopus.design', '1.0.0'),
      capabilities: ['repository.read', 'specification.read', 'specification.write'],
      sideEffectClass: 'specification-write',
      writeScopes: [
        {
          repositorySelector: 'workspace',
          paths: ['openspec/changes/**'],
          operations: ['create', 'update'],
        },
      ],
      outputContract: {
        artifactKinds: ['proposal', 'delta-specs', 'design', 'tasks'],
        trackerPublish: false,
      },
      validatorProfile: validatorProfile('design.artifacts-valid'),
      checkpoint: 'design.after-validation',
    },
    {
      kind: 'task.implement',
      phase: 'build',
      actionSkill: { name: 'tdd' },
      augmentationSkills: [{ name: 'codebase-design' }],
      methodProfile: BUILTIN_METHOD_PROFILE_REGISTRY.snapshot('repoctopus.build', '1.0.0'),
      capabilities: ['process.execute', 'repository.read', 'repository.write'],
      sideEffectClass: 'repository-write',
      writeScopes: [
        {
          repositorySelector: 'all-repositories',
          paths: ['**'],
          operations: ['create', 'update', 'delete'],
        },
      ],
      outputContract: { artifactKinds: [], trackerPublish: false },
      validatorProfile: validatorProfile('build.task-valid'),
      checkpoint: 'build.before-task',
    },
    {
      kind: 'evidence.verify',
      phase: 'verify',
      actionSkill: { name: 'code-review' },
      augmentationSkills: [],
      methodProfile: BUILTIN_METHOD_PROFILE_REGISTRY.snapshot('repoctopus.verify', '1.0.0'),
      capabilities: ['evidence.write', 'process.execute', 'repository.read'],
      sideEffectClass: 'process',
      writeScopes: [],
      outputContract: { artifactKinds: ['verification'], trackerPublish: false },
      validatorProfile: validatorProfile('verify.evidence-gate'),
      checkpoint: 'verify.before-gate',
    },
    {
      kind: 'delivery.await-merge',
      phase: 'archive',
      augmentationSkills: [],
      methodProfile: BUILTIN_METHOD_PROFILE_REGISTRY.snapshot('repoctopus.archive', '1.0.0'),
      capabilities: ['platform.read'],
      sideEffectClass: 'none',
      writeScopes: [],
      outputContract: { artifactKinds: [], trackerPublish: false },
      validatorProfile: validatorProfile('archive.delivery-ready'),
      checkpoint: 'archive.after-merge',
    },
    {
      kind: 'delivery.prepare',
      phase: 'archive',
      actionSkill: { name: 'pr' },
      augmentationSkills: [],
      methodProfile: BUILTIN_METHOD_PROFILE_REGISTRY.snapshot('repoctopus.archive', '1.0.0'),
      capabilities: ['git.publish', 'platform.mutate', 'repository.read'],
      sideEffectClass: 'platform-mutation',
      writeScopes: [],
      outputContract: { artifactKinds: [], trackerPublish: false },
      validatorProfile: validatorProfile('archive.delivery-ready'),
      checkpoint: 'archive.before-publish',
    },
    {
      kind: 'specification.archive',
      phase: 'archive',
      augmentationSkills: [],
      methodProfile: BUILTIN_METHOD_PROFILE_REGISTRY.snapshot('repoctopus.archive', '1.0.0'),
      capabilities: ['git.publish', 'specification.write'],
      sideEffectClass: 'specification-write',
      writeScopes: [
        {
          repositorySelector: 'workspace',
          paths: ['openspec/**'],
          operations: ['create', 'update', 'delete'],
        },
      ],
      outputContract: { artifactKinds: [], trackerPublish: false },
      validatorProfile: validatorProfile('archive.specification-closed'),
      checkpoint: 'archive.before-close',
    },
  ],
  transitions: [
    {
      id: 'open.intake-ready',
      kind: 'advance',
      from: { phase: 'open', statuses: ['running'] },
      to: { phase: 'design', status: 'running' },
      trigger: 'intake-ready',
      requiredValidatorProfile: 'open.intake-ready',
    },
    {
      id: 'design.approved',
      kind: 'advance',
      from: { phase: 'design', statuses: ['running', 'waiting', 'blocked'] },
      to: { phase: 'build', status: 'running' },
      trigger: 'planning-valid-and-approved',
      requiredValidatorProfile: 'design.approval-valid',
    },
    {
      id: 'design.await-approval',
      kind: 'self',
      from: { phase: 'design', statuses: ['running', 'waiting', 'blocked'] },
      to: { phase: 'design', status: 'waiting' },
      trigger: 'planning-valid-awaiting-trusted-decision',
      requiredValidatorProfile: 'design.artifacts-valid',
    },
    {
      id: 'design.invalid',
      kind: 'self',
      from: { phase: 'design', statuses: ['running', 'waiting', 'blocked'] },
      to: { phase: 'design', status: 'blocked' },
      trigger: 'planning-incomplete-or-invalid',
      requiredValidatorProfile: 'design.artifacts-valid',
    },
    {
      id: 'build.validated',
      kind: 'advance',
      from: { phase: 'build', statuses: ['running'] },
      to: { phase: 'verify', status: 'running' },
      trigger: 'all-tasks-validated',
      requiredValidatorProfile: 'build.task-valid',
    },
    {
      id: 'verify.satisfied',
      kind: 'advance',
      from: { phase: 'verify', statuses: ['running'] },
      to: { phase: 'archive', status: 'running' },
      trigger: 'evidence-gate-satisfied',
      requiredValidatorProfile: 'verify.evidence-gate',
    },
    {
      id: 'archive.completed',
      kind: 'complete',
      from: { phase: 'archive', statuses: ['running'] },
      to: { phase: 'archive', status: 'completed' },
      trigger: 'specification-closed-and-final-merge-request-ready',
      requiredValidatorProfile: 'archive.specification-closed',
    },
    {
      id: 'design.revision-requested',
      kind: 'self',
      from: { phase: 'design', statuses: ['waiting'] },
      to: { phase: 'design', status: 'running' },
      trigger: 'planning-revision-requested',
    },
    {
      id: 'build.semantic-plan-drift',
      kind: 'fallback',
      from: { phase: 'build', statuses: ['running', 'blocked'] },
      to: { phase: 'design', status: 'running' },
      trigger: 'semantic-plan-drift-detected',
    },
    {
      id: 'verify.semantic-plan-drift',
      kind: 'fallback',
      from: { phase: 'verify', statuses: ['running', 'blocked'] },
      to: { phase: 'design', status: 'running' },
      trigger: 'semantic-plan-drift-detected',
    },
    {
      id: 'verify.failed',
      kind: 'fallback',
      from: { phase: 'verify', statuses: ['running', 'blocked'] },
      to: { phase: 'build', status: 'running' },
      trigger: 'verification-failed-or-drifted',
    },
    {
      id: 'archive.implementation-drift',
      kind: 'fallback',
      from: { phase: 'archive', statuses: ['running', 'waiting', 'blocked'] },
      to: { phase: 'build', status: 'running' },
      trigger: 'implementation-drift-detected',
    },
    {
      id: 'archive.specification-conflict',
      kind: 'self',
      from: { phase: 'archive', statuses: ['running', 'waiting'] },
      to: { phase: 'archive', status: 'blocked' },
      trigger: 'specification-conflict-detected',
    },
  ],
};

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) throw new Error(`${label} must not be empty`);
}

function assertUniqueNonEmpty(values: readonly string[], label: string): void {
  if (values.length === 0) throw new Error(`${label} must not be empty`);
  const unique = new Set<string>();
  for (const value of values) {
    assertNonEmpty(value, label);
    if (unique.has(value)) throw new Error(`${label} contains duplicate value: ${value}`);
    unique.add(value);
  }
}

function assertProtectedPath(
  transitions: readonly ChangeLifecycleTransitionDefinition[],
  from: ChangePhase,
  to: ChangePhase,
  kind: 'advance' | 'complete',
): void {
  const matches = transitions.filter(
    (transition) =>
      transition.kind === kind && transition.from.phase === from && transition.to.phase === to,
  );
  if (matches.length !== 1) {
    throw new Error(`Lifecycle definition requires exactly one protected ${from} -> ${to} path`);
  }
}

export function assertChangeLifecycleDefinition(
  definition: ChangeLifecycleDefinition,
): asserts definition is ChangeLifecycleDefinition {
  if (definition.schemaVersion !== 1) throw new Error('Unsupported lifecycle definition schema');
  assertNonEmpty(definition.id, 'Lifecycle definition id');
  assertNonEmpty(definition.version, 'Lifecycle definition version');

  if (
    definition.phases.length !== CHANGE_PHASES.length ||
    definition.phases.some((phase, index) => phase.phase !== CHANGE_PHASES[index])
  ) {
    throw new Error(`Lifecycle phases must be exactly ${CHANGE_PHASES.join(' -> ')}`);
  }

  const checkpoints = new Set<string>();
  for (const phase of definition.phases) {
    assertUniqueNonEmpty(phase.workKinds, `${phase.phase} work kinds`);
    assertUniqueNonEmpty(
      phase.requiredValidatorProfiles,
      `${phase.phase} required validator profiles`,
    );
    assertUniqueNonEmpty(phase.extensionCheckpoints, `${phase.phase} extension checkpoints`);
    for (const checkpoint of phase.extensionCheckpoints) {
      if (checkpoints.has(checkpoint)) {
        throw new Error(`Extension checkpoint is declared more than once: ${checkpoint}`);
      }
      checkpoints.add(checkpoint);
    }
  }

  const declaredWorkKinds = new Set(definition.phases.flatMap((phase) => phase.workKinds));
  if (
    definition.works.length !== declaredWorkKinds.size ||
    new Set(definition.works.map((work) => work.kind)).size !== definition.works.length
  ) {
    throw new Error('Lifecycle definition requires exactly one binding for every Work kind');
  }
  for (const work of definition.works) {
    assertNonEmpty(work.kind, 'Lifecycle Work kind');
    const phase = definition.phases.find((candidate) => candidate.phase === work.phase);
    if (!phase?.workKinds.includes(work.kind)) {
      throw new Error(`Lifecycle Work ${work.kind} is outside its declared phase`);
    }
    if (!phase.requiredValidatorProfiles.includes(work.validatorProfile.id)) {
      throw new Error(`Lifecycle Work ${work.kind} validator is outside ${work.phase}`);
    }
    if (!phase.extensionCheckpoints.includes(work.checkpoint)) {
      throw new Error(`Lifecycle Work ${work.kind} checkpoint is outside ${work.phase}`);
    }
    if (!sideEffectClasses.has(work.sideEffectClass)) {
      throw new Error(`Lifecycle Work ${work.kind} uses an unknown side-effect class`);
    }
    assertUniqueNonEmpty(work.capabilities, `Lifecycle Work ${work.kind} capabilities`);
    const skillNames = [
      ...(work.actionSkill ? [work.actionSkill.name] : []),
      ...work.augmentationSkills.map((skill) => skill.name),
    ];
    if (new Set(skillNames).size !== skillNames.length) {
      throw new Error(`Lifecycle Work ${work.kind} repeats an executable Skill`);
    }
    for (const name of skillNames) assertNonEmpty(name, `Lifecycle Work ${work.kind} Skill`);
    for (const name of skillNames) {
      if (behaviorReferenceOnlySkills.has(name)) {
        throw new Error(
          `Lifecycle Work ${work.kind} cannot execute behavior-only reference: ${name}`,
        );
      }
    }
    assertNonEmpty(work.methodProfile.id, `Lifecycle Work ${work.kind} Method Profile`);
    assertNonEmpty(work.methodProfile.version, `Lifecycle Work ${work.kind} Method Profile version`);
    let registeredMethodProfile;
    try {
      registeredMethodProfile = BUILTIN_METHOD_PROFILE_REGISTRY.snapshot(
        work.methodProfile.id,
        work.methodProfile.version,
      );
    } catch {
      throw new Error(`Lifecycle Work ${work.kind} Method Profile is not registered`);
    }
    if (canonicalJson(registeredMethodProfile) !== canonicalJson(work.methodProfile)) {
      throw new Error(`Lifecycle Work ${work.kind} Method Profile digest is invalid`);
    }
    if (
      profileDigest({ id: work.validatorProfile.id, version: work.validatorProfile.version }) !==
      work.validatorProfile.digest
    ) {
      throw new Error(`Lifecycle Work ${work.kind} validator profile digest is invalid`);
    }
    if (work.sideEffectClass === 'none' && work.writeScopes.length > 0) {
      throw new Error(`Lifecycle Work ${work.kind} with no side effects cannot write`);
    }
    for (const scope of work.writeScopes) {
      assertUniqueNonEmpty(scope.paths, `Lifecycle Work ${work.kind} write paths`);
      assertUniqueNonEmpty(scope.operations, `Lifecycle Work ${work.kind} write operations`);
    }
  }
  for (const kind of declaredWorkKinds) {
    if (!definition.works.some((work) => work.kind === kind)) {
      throw new Error(`Lifecycle Work has no immutable binding: ${kind}`);
    }
  }

  if (definition.transitions.length === 0) {
    throw new Error('Lifecycle definition must declare transitions');
  }
  const transitionIds = new Set<string>();
  for (const transition of definition.transitions) {
    assertNonEmpty(transition.id, 'Lifecycle transition id');
    assertNonEmpty(transition.trigger, `Lifecycle transition ${transition.id} trigger`);
    if (!declaredTransitionKinds.has(transition.kind)) {
      throw new Error(
        `Lifecycle transition ${transition.id} uses unknown kind: ${transition.kind}`,
      );
    }
    if (transitionIds.has(transition.id)) {
      throw new Error(`Lifecycle transition id is duplicated: ${transition.id}`);
    }
    transitionIds.add(transition.id);
    assertUniqueNonEmpty(
      transition.from.statuses,
      `Lifecycle transition ${transition.id} statuses`,
    );
    for (const status of transition.from.statuses) {
      if (!declaredStatuses.has(status)) {
        throw new Error(`Lifecycle transition ${transition.id} uses unknown status: ${status}`);
      }
      if (terminalStatuses.has(status)) {
        throw new Error(`Lifecycle transition ${transition.id} cannot start from terminal status`);
      }
    }
    if (!declaredStatuses.has(transition.to.status)) {
      throw new Error(
        `Lifecycle transition ${transition.id} targets unknown status: ${transition.to.status}`,
      );
    }

    const fromIndex = phaseOrder.get(transition.from.phase);
    const toIndex = phaseOrder.get(transition.to.phase);
    if (fromIndex === undefined || toIndex === undefined) {
      throw new Error(`Lifecycle transition ${transition.id} references an undeclared phase`);
    }
    if (transition.kind === 'advance' && toIndex !== fromIndex + 1) {
      throw new Error(`Lifecycle transition ${transition.id} bypasses a protected phase`);
    }
    if (transition.kind === 'self' && toIndex !== fromIndex) {
      throw new Error(`Lifecycle self transition ${transition.id} must remain in its phase`);
    }
    if (transition.kind === 'fallback' && toIndex >= fromIndex) {
      throw new Error(
        `Lifecycle fallback transition ${transition.id} must target an earlier phase`,
      );
    }
    if (
      transition.kind === 'complete' &&
      (transition.from.phase !== 'archive' ||
        transition.to.phase !== 'archive' ||
        transition.to.status !== 'completed')
    ) {
      throw new Error(`Lifecycle completion ${transition.id} must complete in Archive`);
    }
    if (transition.kind !== 'complete' && terminalStatuses.has(transition.to.status)) {
      throw new Error(`Lifecycle transition ${transition.id} cannot target a terminal status`);
    }
    if (transition.kind === 'complete' && !transition.requiredValidatorProfile) {
      throw new Error(`Lifecycle completion ${transition.id} requires a validator profile`);
    }
    if (transition.requiredValidatorProfile) {
      const source = definition.phases[fromIndex]!;
      if (!source.requiredValidatorProfiles.includes(transition.requiredValidatorProfile)) {
        throw new Error(
          `Lifecycle transition ${transition.id} references validator outside ${source.phase}`,
        );
      }
    }
  }

  for (let index = 0; index < CHANGE_PHASES.length - 1; index += 1) {
    assertProtectedPath(
      definition.transitions,
      CHANGE_PHASES[index]!,
      CHANGE_PHASES[index + 1]!,
      'advance',
    );
  }
  assertProtectedPath(definition.transitions, 'archive', 'archive', 'complete');
}

function normalizePhase(phase: ChangeLifecyclePhaseDefinition): ChangeLifecyclePhaseDefinition {
  return {
    phase: phase.phase,
    workKinds: [...phase.workKinds].sort(),
    requiredValidatorProfiles: [...phase.requiredValidatorProfiles].sort(),
    extensionCheckpoints: [...phase.extensionCheckpoints].sort(),
  };
}

function normalizeTransition(
  transition: ChangeLifecycleTransitionDefinition,
): ChangeLifecycleTransitionDefinition {
  return {
    id: transition.id,
    kind: transition.kind,
    from: {
      phase: transition.from.phase,
      statuses: [...transition.from.statuses].sort(
        (left, right) => statusOrder.get(left)! - statusOrder.get(right)!,
      ),
    },
    to: { phase: transition.to.phase, status: transition.to.status },
    trigger: transition.trigger,
    ...(transition.requiredValidatorProfile
      ? { requiredValidatorProfile: transition.requiredValidatorProfile }
      : {}),
  };
}

function normalizeWork(
  work: ChangeLifecycleDefinition['works'][number],
): ChangeLifecycleDefinition['works'][number] {
  return {
    kind: work.kind,
    phase: work.phase,
    ...(work.actionSkill ? { actionSkill: structuredClone(work.actionSkill) } : {}),
    augmentationSkills: structuredClone(work.augmentationSkills),
    methodProfile: structuredClone(work.methodProfile),
    capabilities: [...work.capabilities].sort(),
    sideEffectClass: work.sideEffectClass,
    writeScopes: work.writeScopes.map((scope) => ({
      repositorySelector: scope.repositorySelector,
      paths: [...scope.paths].sort(),
      operations: [...scope.operations].sort(),
    })),
    outputContract: {
      ...(work.outputContract.providerId
        ? { providerId: work.outputContract.providerId }
        : {}),
      artifactKinds: [...work.outputContract.artifactKinds].sort(),
      trackerPublish: work.outputContract.trackerPublish,
    },
    validatorProfile: structuredClone(work.validatorProfile),
    checkpoint: work.checkpoint,
  };
}

export function normalizeChangeLifecycleDefinition(
  definition: ChangeLifecycleDefinition,
): ChangeLifecycleDefinition {
  assertChangeLifecycleDefinition(definition);
  return {
    schemaVersion: 1,
    id: definition.id,
    version: definition.version,
    phases: definition.phases.map(normalizePhase),
    works: definition.works.map(normalizeWork).sort((left, right) => left.kind.localeCompare(right.kind)),
    transitions: definition.transitions
      .map(normalizeTransition)
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function digestChangeLifecycleDefinition(
  definition: ChangeLifecycleDefinition,
): `sha256:${string}` {
  const normalized = normalizeChangeLifecycleDefinition(definition);
  return `sha256:${createHash('sha256').update(canonicalJson(normalized)).digest('hex')}`;
}

export interface PreparedChangeLifecycleDefinition {
  definition: ChangeLifecycleDefinition;
  snapshot: ChangeLifecycleDefinitionSnapshot;
}

export function prepareChangeLifecycleDefinition(
  definition: ChangeLifecycleDefinition = BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
): PreparedChangeLifecycleDefinition {
  const normalized = normalizeChangeLifecycleDefinition(definition);
  return {
    definition: normalized,
    snapshot: {
      id: normalized.id,
      version: normalized.version,
      digest: digestChangeLifecycleDefinition(normalized),
    },
  };
}

function assertChangeRunIdentity(identity: ChangeRunIdentity): void {
  assertNonEmpty(identity.workspaceId, 'Change Run workspace id');
  assertNonEmpty(identity.changeId, 'Change Run change id');
  assertNonEmpty(identity.runId, 'Change Run id');
  if (!Number.isSafeInteger(identity.generation) || identity.generation < 1) {
    throw new Error('Change Run generation must be a positive safe integer');
  }
}

export function createChangeLifecycleSnapshot(options: {
  identity: ChangeRunIdentity;
  definition?: ChangeLifecycleDefinition;
}): ChangeLifecycleSnapshot {
  assertChangeRunIdentity(options.identity);
  const prepared = prepareChangeLifecycleDefinition(options.definition);
  const snapshot: ChangeLifecycleSnapshot = {
    schemaVersion: 1,
    identity: structuredClone(options.identity),
    definition: prepared.snapshot,
    revision: 0,
    phase: 'open',
    status: 'running',
    currentWork: null,
    waitCondition: null,
    blocker: null,
    tasks: [],
  };
  assertChangeLifecycleSnapshot(snapshot);
  return snapshot;
}

export interface ChangeLifecycleRecoveryResult {
  compatibility: 'same' | 'completed_history' | 'migration_required';
  expected: ChangeLifecycleDefinitionSnapshot;
  current: ChangeLifecycleDefinitionSnapshot;
  changed: boolean;
  snapshot: ChangeLifecycleSnapshot;
}

export function recoverChangeLifecycleSnapshot(options: {
  persisted: ChangeLifecycleSnapshot;
  currentDefinition?: ChangeLifecycleDefinition;
}): ChangeLifecycleRecoveryResult {
  assertChangeLifecycleSnapshot(options.persisted);
  const current = prepareChangeLifecycleDefinition(options.currentDefinition).snapshot;
  const expected = structuredClone(options.persisted.definition);
  const definitionMatches =
    expected.id === current.id &&
    expected.version === current.version &&
    expected.digest === current.digest;

  if (definitionMatches) {
    return {
      compatibility: 'same',
      expected,
      current,
      changed: false,
      snapshot: structuredClone(options.persisted),
    };
  }
  if (options.persisted.status === 'completed') {
    return {
      compatibility: 'completed_history',
      expected,
      current,
      changed: false,
      snapshot: structuredClone(options.persisted),
    };
  }

  const evidenceIds = [expected.digest, current.digest];
  const alreadyStopped =
    options.persisted.status === 'migration_required' &&
    options.persisted.blocker?.code === 'change-lifecycle.definition-drift' &&
    canonicalJson(options.persisted.blocker.evidenceIds) === canonicalJson(evidenceIds);
  if (alreadyStopped) {
    return {
      compatibility: 'migration_required',
      expected,
      current,
      changed: false,
      snapshot: structuredClone(options.persisted),
    };
  }

  const revision = options.persisted.revision + 1;
  const snapshot: ChangeLifecycleSnapshot = {
    ...structuredClone(options.persisted),
    revision,
    status: 'migration_required',
    currentWork: null,
    waitCondition: null,
    blocker: {
      code: 'change-lifecycle.definition-drift',
      message: `Lifecycle definition ${expected.id}@${expected.version} no longer matches its fixed digest`,
      evidenceIds,
      sinceRevision: revision,
    },
  };
  assertChangeLifecycleSnapshot(snapshot);
  return {
    compatibility: 'migration_required',
    expected,
    current,
    changed: true,
    snapshot,
  };
}
