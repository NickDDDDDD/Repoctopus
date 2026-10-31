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
const declaredTransitionKinds = new Set<string>([
  'advance',
  'self',
  'fallback',
  'halt',
  'complete',
]);
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
const expectedBuildActions = ['configure', 'plan', 'plan-evidence', 'execute', 'check'] as const;

function profileDigest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function validatorProfile(id: string) {
  const stable = { id, version: '1.0.0' } as const;
  return { ...stable, digest: profileDigest(stable) };
}

export const BUILTIN_CHANGE_LIFECYCLE_DEFINITION: ChangeLifecycleDefinition = {
  schemaVersion: 3,
  id: 'repoctopus-change',
  version: '4.5.0',
  phases: [
    {
      phase: 'open',
      workKinds: ['change.intake'],
      requiredValidatorProfiles: ['open.intake-ready'],
      extensionCheckpoints: ['open.after-intake'],
    },
    {
      phase: 'design',
      workKinds: ['specification.plan'],
      requiredValidatorProfiles: ['design.approval-valid', 'design.artifacts-valid'],
      extensionCheckpoints: ['design.after-approval', 'design.after-validation'],
    },
    {
      phase: 'build',
      workKinds: ['build.configure', 'build.plan', 'build.execute', 'build.check'],
      requiredValidatorProfiles: [
        'build.configuration-approved',
        'build.plan-valid',
        'build.plan-evidence-valid',
        'build.package-valid',
        'build.check-valid',
      ],
      extensionCheckpoints: [
        'build.after-check',
        'build.after-execute',
        'build.after-plan',
        'build.before-configure',
      ],
    },
    {
      phase: 'verify',
      workKinds: ['evidence.verify'],
      requiredValidatorProfiles: ['verify.evidence-gate'],
      extensionCheckpoints: ['verify.after-gate', 'verify.before-gate'],
    },
    {
      phase: 'archive',
      workKinds: ['specification.close', 'delivery.publish'],
      requiredValidatorProfiles: ['archive.preflight-valid', 'archive.publication-complete'],
      extensionCheckpoints: ['archive.before-close', 'archive.before-publish'],
    },
  ],
  works: [
    {
      kind: 'change.intake',
      phase: 'open',
      actionSkill: { name: 'repoctopus-open-change' },
      augmentationSkills: [{ name: 'grilling' }],
      augmentationSlots: [
        {
          id: 'open-method',
          defaultSkill: { name: 'grilling' },
          replaceable: true,
          contract: { modelInvocable: true, artifactProtocolOwner: false },
        },
      ],
      methodProfile: BUILTIN_METHOD_PROFILE_REGISTRY.snapshot('repoctopus.open', '1.0.0'),
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
      validatorProfile: validatorProfile('open.intake-ready'),
      checkpoint: 'open.after-intake',
    },
    {
      kind: 'specification.plan',
      phase: 'design',
      actionSkill: { name: 'repoctopus-design-change' },
      augmentationSkills: [{ name: 'codebase-design' }],
      augmentationSlots: [
        {
          id: 'design-method',
          defaultSkill: { name: 'codebase-design' },
          replaceable: true,
          contract: { modelInvocable: true, artifactProtocolOwner: false },
        },
      ],
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
      kind: 'build.configure',
      phase: 'build',
      actionSkill: { name: 'repoctopus-build-configure' },
      augmentationSkills: [],
      methodProfile: BUILTIN_METHOD_PROFILE_REGISTRY.snapshot('repoctopus.build', '1.0.0'),
      capabilities: ['repository.read'],
      sideEffectClass: 'none',
      writeScopes: [],
      outputContract: { artifactKinds: [], trackerPublish: false },
      validatorProfile: validatorProfile('build.configuration-approved'),
      checkpoint: 'build.before-configure',
    },
    {
      kind: 'build.plan',
      phase: 'build',
      actionSkill: { name: 'repoctopus-build-plan' },
      augmentationSkills: [],
      methodProfile: BUILTIN_METHOD_PROFILE_REGISTRY.snapshot('repoctopus.build', '1.0.0'),
      capabilities: ['repository.read', 'specification.read'],
      sideEffectClass: 'none',
      writeScopes: [],
      outputContract: { artifactKinds: [], trackerPublish: false },
      validatorProfile: validatorProfile('build.plan-valid'),
      checkpoint: 'build.after-plan',
    },
    {
      kind: 'build.execute',
      phase: 'build',
      actionSkill: { name: 'repoctopus-build-execute' },
      augmentationSkills: [],
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
      validatorProfile: validatorProfile('build.package-valid'),
      checkpoint: 'build.after-execute',
    },
    {
      kind: 'build.check',
      phase: 'build',
      actionSkill: { name: 'repoctopus-build-check' },
      augmentationSkills: [],
      methodProfile: BUILTIN_METHOD_PROFILE_REGISTRY.snapshot('repoctopus.build', '1.0.0'),
      capabilities: ['process.execute', 'repository.read'],
      sideEffectClass: 'process',
      writeScopes: [],
      outputContract: { artifactKinds: [], trackerPublish: false },
      validatorProfile: validatorProfile('build.check-valid'),
      checkpoint: 'build.after-check',
    },
    {
      kind: 'evidence.verify',
      phase: 'verify',
      actionSkill: { name: 'repoctopus-verify-change' },
      augmentationSkills: [{ name: 'code-review' }],
      augmentationSlots: [
        {
          id: 'verify-review',
          defaultSkill: { name: 'code-review' },
          replaceable: true,
          contract: { modelInvocable: true, artifactProtocolOwner: false },
        },
      ],
      methodProfile: BUILTIN_METHOD_PROFILE_REGISTRY.snapshot('repoctopus.verify', '1.0.0'),
      capabilities: ['evidence.write', 'process.execute', 'repository.read'],
      sideEffectClass: 'process',
      writeScopes: [],
      outputContract: { artifactKinds: ['verification'], trackerPublish: false },
      validatorProfile: validatorProfile('verify.evidence-gate'),
      checkpoint: 'verify.before-gate',
    },
    {
      kind: 'specification.close',
      phase: 'archive',
      actionSkill: { name: 'repoctopus-archive-change' },
      augmentationSkills: [],
      methodProfile: BUILTIN_METHOD_PROFILE_REGISTRY.snapshot('repoctopus.archive', '1.0.0'),
      capabilities: ['repository.read', 'specification.write'],
      sideEffectClass: 'specification-write',
      writeScopes: [
        {
          repositorySelector: 'workspace',
          paths: ['openspec/**'],
          operations: ['create', 'update', 'delete'],
        },
      ],
      outputContract: { artifactKinds: [], trackerPublish: false },
      validatorProfile: validatorProfile('archive.preflight-valid'),
      checkpoint: 'archive.before-close',
    },
    {
      kind: 'delivery.publish',
      phase: 'archive',
      actionSkill: { name: 'pr' },
      augmentationSkills: [],
      methodProfile: BUILTIN_METHOD_PROFILE_REGISTRY.snapshot('repoctopus.archive', '1.0.0'),
      capabilities: ['git.publish', 'platform.mutate', 'repository.read'],
      sideEffectClass: 'platform-mutation',
      writeScopes: [],
      outputContract: { artifactKinds: [], trackerPublish: false },
      validatorProfile: validatorProfile('archive.publication-complete'),
      checkpoint: 'archive.before-publish',
    },
  ],
  transitions: [
    {
      id: 'open.work-ready',
      kind: 'self',
      from: { phase: 'open', statuses: ['running', 'waiting', 'blocked'] },
      to: { phase: 'open', status: 'running' },
      trigger: 'open-work-created',
      requiredValidatorProfile: 'open.intake-ready',
    },
    {
      id: 'open.approved',
      kind: 'advance',
      from: { phase: 'open', statuses: ['running', 'waiting', 'blocked'] },
      to: { phase: 'design', status: 'running' },
      trigger: 'open-valid-and-approved',
      requiredValidatorProfile: 'open.intake-ready',
    },
    {
      id: 'open.await-approval',
      kind: 'self',
      from: { phase: 'open', statuses: ['running', 'waiting', 'blocked'] },
      to: { phase: 'open', status: 'waiting' },
      trigger: 'open-valid-awaiting-trusted-decision',
      requiredValidatorProfile: 'open.intake-ready',
    },
    {
      id: 'open.intent-selected',
      kind: 'self',
      from: { phase: 'open', statuses: ['waiting'] },
      to: { phase: 'open', status: 'waiting' },
      trigger: 'trusted-execution-workspace-intent-selected',
      requiredValidatorProfile: 'open.intake-ready',
    },
    {
      id: 'open.workspace-intent-revised',
      kind: 'advance',
      from: { phase: 'open', statuses: ['waiting'] },
      to: { phase: 'design', status: 'running' },
      trigger: 'trusted-execution-workspace-intent-revised',
      requiredValidatorProfile: 'open.intake-ready',
    },
    {
      id: 'open.invalid',
      kind: 'self',
      from: { phase: 'open', statuses: ['running', 'waiting', 'blocked'] },
      to: { phase: 'open', status: 'blocked' },
      trigger: 'open-incomplete-or-invalid',
      requiredValidatorProfile: 'open.intake-ready',
    },
    {
      id: 'open.repair-required',
      kind: 'self',
      from: { phase: 'open', statuses: ['running', 'waiting', 'blocked'] },
      to: { phase: 'open', status: 'running' },
      trigger: 'open-evidence-rejected',
      requiredValidatorProfile: 'open.intake-ready',
    },
    {
      id: 'design.work-ready',
      kind: 'self',
      from: { phase: 'design', statuses: ['running', 'waiting', 'blocked'] },
      to: { phase: 'design', status: 'running' },
      trigger: 'design-work-created',
      requiredValidatorProfile: 'design.artifacts-valid',
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
      id: 'build.adoption-required',
      kind: 'self',
      from: { phase: 'build', statuses: ['running'] },
      to: { phase: 'build', status: 'waiting' },
      trigger: 'planning-valid-precompleted-tasks-require-decision',
      requiredValidatorProfile: 'build.plan-valid',
    },
    {
      id: 'build.configuration-awaiting-approval',
      kind: 'self',
      from: { phase: 'build', statuses: ['running'] },
      to: { phase: 'build', status: 'waiting' },
      trigger: 'configuration-proposal-validated',
      requiredValidatorProfile: 'build.configuration-approved',
    },
    {
      id: 'build.workspace-intent-revision-required',
      kind: 'fallback',
      from: { phase: 'build', statuses: ['running'] },
      to: { phase: 'open', status: 'waiting' },
      trigger: 'configuration-binding-requires-workspace-intent-revision',
      requiredValidatorProfile: 'build.configuration-approved',
    },
    {
      id: 'build.configuration-retry',
      kind: 'self',
      from: { phase: 'build', statuses: ['running'] },
      to: { phase: 'build', status: 'running' },
      trigger: 'configuration-host-capability-retry',
      requiredValidatorProfile: 'build.configuration-approved',
    },
    {
      id: 'build.configuration-approved',
      kind: 'self',
      from: { phase: 'build', statuses: ['waiting'] },
      to: { phase: 'build', status: 'running' },
      trigger: 'configuration-approved-by-trusted-human',
      requiredValidatorProfile: 'build.configuration-approved',
    },
    {
      id: 'build.configuration-rejected',
      kind: 'self',
      from: { phase: 'build', statuses: ['waiting'] },
      to: { phase: 'build', status: 'running' },
      trigger: 'configuration-rejected-or-revised',
      requiredValidatorProfile: 'build.configuration-approved',
    },
    {
      id: 'build.plan-accepted',
      kind: 'self',
      from: { phase: 'build', statuses: ['running'] },
      to: { phase: 'build', status: 'running' },
      trigger: 'structured-plan-candidate-validated',
      requiredValidatorProfile: 'build.plan-valid',
    },
    {
      id: 'build.plan-retry',
      kind: 'self',
      from: { phase: 'build', statuses: ['running'] },
      to: { phase: 'build', status: 'running' },
      trigger: 'plan-host-validation-retry',
      requiredValidatorProfile: 'build.plan-valid',
    },
    {
      id: 'build.work-execution-migration-required',
      kind: 'halt',
      from: { phase: 'build', statuses: ['running'] },
      to: { phase: 'build', status: 'migration_required' },
      trigger: 'legacy-work-execution-state-is-not-provably-compatible',
      requiredValidatorProfile: 'build.plan-valid',
    },
    {
      id: 'build.check-work-execution-migration-required',
      kind: 'halt',
      from: { phase: 'build', statuses: ['running'] },
      to: { phase: 'build', status: 'migration_required' },
      trigger: 'legacy-build-check-state-is-not-provably-compatible',
      requiredValidatorProfile: 'build.check-valid',
    },
    {
      id: 'build.plan-evidence-accepted',
      kind: 'self',
      from: { phase: 'build', statuses: ['running'] },
      to: { phase: 'build', status: 'running' },
      trigger: 'plan-evidence-accepted',
      requiredValidatorProfile: 'build.plan-evidence-valid',
    },
    {
      id: 'build.plan-approval-required',
      kind: 'self',
      from: { phase: 'build', statuses: ['running'] },
      to: { phase: 'build', status: 'waiting' },
      trigger: 'high-risk-plan-requires-trusted-decision',
      requiredValidatorProfile: 'build.plan-evidence-valid',
    },
    {
      id: 'build.plan-approved',
      kind: 'self',
      from: { phase: 'build', statuses: ['waiting'] },
      to: { phase: 'build', status: 'running' },
      trigger: 'high-risk-plan-approved-by-trusted-human',
      requiredValidatorProfile: 'build.plan-evidence-valid',
    },
    {
      id: 'build.plan-rejected',
      kind: 'self',
      from: { phase: 'build', statuses: ['waiting'] },
      to: { phase: 'build', status: 'running' },
      trigger: 'high-risk-plan-rejected-for-revision',
      requiredValidatorProfile: 'build.plan-evidence-valid',
    },
    {
      id: 'build.check-rejected',
      kind: 'self',
      from: { phase: 'build', statuses: ['running'] },
      to: { phase: 'build', status: 'running' },
      trigger: 'build-check-finding-requires-plan-revision',
      requiredValidatorProfile: 'build.check-valid',
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
      id: 'build.task-ready',
      kind: 'self',
      from: { phase: 'build', statuses: ['running'] },
      to: { phase: 'build', status: 'running' },
      trigger: 'next-task-ready',
      requiredValidatorProfile: 'build.plan-valid',
    },
    {
      id: 'build.adoption-approved',
      kind: 'self',
      from: { phase: 'build', statuses: ['waiting'] },
      to: { phase: 'build', status: 'running' },
      trigger: 'precompleted-task-claims-adopted',
      requiredValidatorProfile: 'build.plan-valid',
    },
    {
      id: 'build.adoption-rejected',
      kind: 'self',
      from: { phase: 'build', statuses: ['waiting'] },
      to: { phase: 'build', status: 'blocked' },
      trigger: 'precompleted-task-claims-rejected',
      requiredValidatorProfile: 'build.plan-valid',
    },
    {
      id: 'build.retry-exhausted',
      kind: 'self',
      from: { phase: 'build', statuses: ['running'] },
      to: { phase: 'build', status: 'blocked' },
      trigger: 'bounded-work-attempts-exhausted',
      requiredValidatorProfile: 'build.package-valid',
    },
    {
      id: 'build.design-revision-required',
      kind: 'self',
      from: { phase: 'build', statuses: ['running'] },
      to: { phase: 'build', status: 'waiting' },
      trigger: 'host-reported-design-assumption-invalid',
      requiredValidatorProfile: 'build.package-valid',
    },
    {
      id: 'build.design-revision-approved',
      kind: 'fallback',
      from: { phase: 'build', statuses: ['waiting'] },
      to: { phase: 'design', status: 'running' },
      trigger: 'human-approved-design-revision',
      requiredValidatorProfile: 'build.plan-valid',
    },
    {
      id: 'build.design-revision-rejected',
      kind: 'self',
      from: { phase: 'build', statuses: ['waiting'] },
      to: { phase: 'build', status: 'blocked' },
      trigger: 'human-rejected-design-revision',
      requiredValidatorProfile: 'build.plan-valid',
    },
    {
      id: 'build.task-completed',
      kind: 'self',
      from: { phase: 'build', statuses: ['running'] },
      to: { phase: 'build', status: 'running' },
      trigger: 'task-outcome-validated',
      requiredValidatorProfile: 'build.package-valid',
    },
    {
      id: 'build.package-completed',
      kind: 'self',
      from: { phase: 'build', statuses: ['running'] },
      to: { phase: 'build', status: 'running' },
      trigger: 'planned-package-outcome-validated',
      requiredValidatorProfile: 'build.package-valid',
    },
    {
      id: 'build.verification-blocked',
      kind: 'self',
      from: { phase: 'build', statuses: ['running', 'blocked'] },
      to: { phase: 'build', status: 'blocked' },
      trigger: 'verification-input-incomplete',
      requiredValidatorProfile: 'build.plan-evidence-valid',
    },
    {
      id: 'build.validated',
      kind: 'advance',
      from: { phase: 'build', statuses: ['running', 'blocked'] },
      to: { phase: 'verify', status: 'running' },
      trigger: 'all-tasks-validated',
      requiredValidatorProfile: 'build.check-valid',
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
      id: 'archive.preflight-ready',
      kind: 'self',
      from: { phase: 'archive', statuses: ['running'] },
      to: { phase: 'archive', status: 'running' },
      trigger: 'archive-preflight-accepted',
      requiredValidatorProfile: 'archive.preflight-valid',
    },
    {
      id: 'archive.reverify',
      kind: 'fallback',
      from: { phase: 'archive', statuses: ['running'] },
      to: { phase: 'verify', status: 'running' },
      trigger: 'verification-input-stale-before-side-effects',
      requiredValidatorProfile: 'archive.preflight-valid',
    },
    {
      id: 'archive.specification-closed',
      kind: 'self',
      from: { phase: 'archive', statuses: ['running'] },
      to: { phase: 'archive', status: 'running' },
      trigger: 'specification-closure-receipt-accepted',
      requiredValidatorProfile: 'archive.preflight-valid',
    },
    {
      id: 'archive.intent-corrected',
      kind: 'self',
      from: { phase: 'archive', statuses: ['running'] },
      to: { phase: 'archive', status: 'running' },
      trigger: 'archive-intent-corrected-before-publication',
      requiredValidatorProfile: 'archive.preflight-valid',
    },
    {
      id: 'archive.planning-drift',
      kind: 'fallback',
      from: { phase: 'archive', statuses: ['running'] },
      to: { phase: 'design', status: 'running' },
      trigger: 'planning-drift-before-remote-publication',
      requiredValidatorProfile: 'archive.preflight-valid',
    },
    {
      id: 'archive.work-restored',
      kind: 'self',
      from: { phase: 'archive', statuses: ['running'] },
      to: { phase: 'archive', status: 'running' },
      trigger: 'compatible-definition-restored-archive-work',
      requiredValidatorProfile: 'archive.preflight-valid',
    },
    {
      id: 'archive.completed',
      kind: 'complete',
      from: { phase: 'archive', statuses: ['running'] },
      to: { phase: 'archive', status: 'completed' },
      trigger: 'publication-receipt-accepted',
      requiredValidatorProfile: 'archive.publication-complete',
    },
    {
      id: 'archive.publication-blocked',
      kind: 'self',
      from: { phase: 'archive', statuses: ['running', 'blocked'] },
      to: { phase: 'archive', status: 'blocked' },
      trigger: 'publication-receipt-missing-or-invalid',
      requiredValidatorProfile: 'archive.publication-complete',
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
      id: 'verify.retry',
      kind: 'self',
      from: { phase: 'verify', statuses: ['running', 'blocked'] },
      to: { phase: 'verify', status: 'running' },
      trigger: 'evidence-or-infrastructure-retry',
      requiredValidatorProfile: 'verify.evidence-gate',
    },
    {
      id: 'archive.specification-conflict',
      kind: 'self',
      from: { phase: 'archive', statuses: ['running', 'waiting'] },
      to: { phase: 'archive', status: 'blocked' },
      trigger: 'specification-conflict-detected',
    },
  ],
  buildProtocol: {
    schemaVersion: 1,
    actions: [
      {
        action: 'configure',
        workKind: 'build.configure',
        validatorProfile: 'build.configuration-approved',
        next: 'plan',
        autoTransition: false,
      },
      {
        action: 'plan',
        workKind: 'build.plan',
        validatorProfile: 'build.plan-valid',
        next: 'plan-evidence',
        autoTransition: true,
      },
      {
        action: 'plan-evidence',
        workKind: null,
        validatorProfile: 'build.plan-evidence-valid',
        next: 'execute',
        autoTransition: true,
      },
      {
        action: 'execute',
        workKind: 'build.execute',
        validatorProfile: 'build.package-valid',
        next: 'check',
        autoTransition: true,
      },
      {
        action: 'check',
        workKind: 'build.check',
        validatorProfile: 'build.check-valid',
        next: 'verify',
        autoTransition: false,
      },
    ],
    policies: {
      executionModes: ['autonomous', 'subagent-driven-development'],
      tddModes: ['tdd', 'direct'],
      reviewModes: ['standard'],
      isolations: ['current', 'branch', 'worktree'],
      allowRuntimeModeSwitch: false,
    },
  },
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
  if (matches.length === 0) {
    throw new Error(`Lifecycle definition requires a protected ${from} -> ${to} path`);
  }
}

export function assertChangeLifecycleDefinition(
  definition: ChangeLifecycleDefinition,
): asserts definition is ChangeLifecycleDefinition {
  if (definition.schemaVersion !== 3) throw new Error('Unsupported lifecycle definition schema');
  assertNonEmpty(definition.id, 'Lifecycle definition id');
  assertNonEmpty(definition.version, 'Lifecycle definition version');
  for (const compatibleDigest of definition.compatibleDigests ?? []) {
    if (!/^sha256:[a-f0-9]{64}$/u.test(compatibleDigest)) {
      throw new Error('Lifecycle compatible definition digest must be a sha256 digest');
    }
  }

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
    const slots = work.augmentationSlots ?? [];
    if (slots.length > 0) {
      assertUniqueNonEmpty(
        slots.map((slot) => slot.id),
        `Lifecycle Work ${work.kind} augmentation slots`,
      );
    }
    for (const slot of slots) {
      const matches = work.augmentationSkills.filter(
        (skill) => skill.name === slot.defaultSkill.name,
      );
      if (matches.length !== 1) {
        throw new Error(
          `Lifecycle Work ${work.kind} augmentation slot ${slot.id} must own exactly one built-in augmentation`,
        );
      }
      if (slot.contract.modelInvocable !== true || slot.contract.artifactProtocolOwner !== false) {
        throw new Error(`Lifecycle Work ${work.kind} augmentation slot contract is unsupported`);
      }
    }
    assertNonEmpty(work.methodProfile.id, `Lifecycle Work ${work.kind} Method Profile`);
    assertNonEmpty(
      work.methodProfile.version,
      `Lifecycle Work ${work.kind} Method Profile version`,
    );
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

  const build = definition.buildProtocol;
  if (build.schemaVersion !== 1) throw new Error('Unsupported Build protocol schema');
  if (
    build.actions.length !== expectedBuildActions.length ||
    build.actions.some((action, index) => action.action !== expectedBuildActions[index])
  ) {
    throw new Error(`Build Actions must be exactly ${expectedBuildActions.join(' -> ')}`);
  }
  const expectedNext = ['plan', 'plan-evidence', 'execute', 'check', 'verify'];
  for (const [index, action] of build.actions.entries()) {
    if (action.next !== expectedNext[index])
      throw new Error('Build Action order cannot be changed');
    if (action.action === 'plan-evidence') {
      if (action.workKind !== null) throw new Error('Plan Evidence is a Runtime validator Action');
    } else {
      const work = definition.works.find((candidate) => candidate.kind === action.workKind);
      if (!work || work.phase !== 'build') {
        throw new Error(`Build Action ${action.action} must bind one Build Work`);
      }
      if (work.validatorProfile.id !== action.validatorProfile) {
        throw new Error(`Build Action ${action.action} validator does not match its Work`);
      }
    }
  }
  if (
    canonicalJson(build.policies) !==
    canonicalJson({
      executionModes: ['autonomous', 'subagent-driven-development'],
      tddModes: ['tdd', 'direct'],
      reviewModes: ['standard'],
      isolations: ['current', 'branch', 'worktree'],
      allowRuntimeModeSwitch: false,
    })
  ) {
    throw new Error('Build protocol policies contain unsupported or reordered modes');
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
      transition.kind === 'halt' &&
      (toIndex !== fromIndex || !['failed', 'migration_required'].includes(transition.to.status))
    ) {
      throw new Error(
        `Lifecycle halt transition ${transition.id} must stop in failed or migration_required within its phase`,
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
    if (
      transition.kind !== 'complete' &&
      transition.kind !== 'halt' &&
      terminalStatuses.has(transition.to.status)
    ) {
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
    ...(work.augmentationSlots?.length
      ? {
          augmentationSlots: [...work.augmentationSlots]
            .sort((left, right) => left.id.localeCompare(right.id))
            .map((slot) => structuredClone(slot)),
        }
      : {}),
    methodProfile: structuredClone(work.methodProfile),
    capabilities: [...work.capabilities].sort(),
    sideEffectClass: work.sideEffectClass,
    writeScopes: work.writeScopes.map((scope) => ({
      repositorySelector: scope.repositorySelector,
      paths: [...scope.paths].sort(),
      operations: [...scope.operations].sort(),
    })),
    outputContract: {
      ...(work.outputContract.providerId ? { providerId: work.outputContract.providerId } : {}),
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
    schemaVersion: 3,
    id: definition.id,
    version: definition.version,
    ...(definition.compatibleDigests?.length
      ? { compatibleDigests: [...new Set(definition.compatibleDigests)].sort() }
      : {}),
    phases: definition.phases.map(normalizePhase),
    works: definition.works
      .map(normalizeWork)
      .sort((left, right) => left.kind.localeCompare(right.kind)),
    transitions: definition.transitions
      .map(normalizeTransition)
      .sort((left, right) => left.id.localeCompare(right.id)),
    buildProtocol: structuredClone(definition.buildProtocol),
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
}

export function createChangeLifecycleSnapshot(options: {
  identity: ChangeRunIdentity;
  definition?: ChangeLifecycleDefinition;
}): ChangeLifecycleSnapshot {
  assertChangeRunIdentity(options.identity);
  const prepared = prepareChangeLifecycleDefinition(options.definition);
  const snapshot: ChangeLifecycleSnapshot = {
    schemaVersion: 2,
    identity: structuredClone(options.identity),
    definition: prepared.snapshot,
    revision: 0,
    checkEpoch: 0,
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
  compatibility: 'same' | 'compatible' | 'completed_history' | 'migration_required';
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

  const verificationSchemaVersion = (
    options.persisted.verificationInput as unknown as { schemaVersion?: number } | undefined
  )?.schemaVersion;
  if (
    verificationSchemaVersion !== undefined &&
    verificationSchemaVersion !== 2 &&
    options.persisted.status !== 'completed'
  ) {
    const evidenceIds = [
      `verification-input:v${verificationSchemaVersion}`,
      'verification-input:v2',
    ];
    const alreadyStopped =
      options.persisted.status === 'migration_required' &&
      options.persisted.blocker?.code === 'change-lifecycle.verification-input-schema-drift' &&
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
        code: 'change-lifecycle.verification-input-schema-drift',
        message: `Verification Input schema v${verificationSchemaVersion} cannot produce an Acceptance Trace`,
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

  if (definitionMatches) {
    return {
      compatibility: 'same',
      expected,
      current,
      changed: false,
      snapshot: structuredClone(options.persisted),
    };
  }
  if (
    expected.id === current.id &&
    options.currentDefinition?.compatibleDigests?.includes(expected.digest)
  ) {
    const wasDefinitionDrift =
      options.persisted.status === 'migration_required' &&
      options.persisted.blocker?.code === 'change-lifecycle.definition-drift' &&
      options.persisted.blocker.evidenceIds.includes(expected.digest);
    const snapshot: ChangeLifecycleSnapshot = {
      ...structuredClone(options.persisted),
      definition: current,
      revision: options.persisted.revision + 1,
      ...(wasDefinitionDrift
        ? { status: 'running' as const, blocker: null, waitCondition: null }
        : {}),
    };
    assertChangeLifecycleSnapshot(snapshot);
    return {
      compatibility: 'compatible',
      expected,
      current,
      changed: true,
      snapshot,
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
