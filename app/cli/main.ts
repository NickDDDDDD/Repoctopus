import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import type {
  DeliveryIntentV3,
  DeliveryPolicy,
  DeliveryState,
  DeliveryStateV3,
} from '../../domains/delivery/types.js';
import { parseDeliveryIntentV3 } from '../../domains/delivery/v3.js';
import type { DeliveryV2MigrationPlan } from '../../domains/delivery/migration.js';
import type { ProjectSnapshot } from '../../domains/project/types.js';
import type { EffectiveProjectConfig } from '../../domains/project-configuration/types.js';
import type {
  ResumeView,
  RunStatusView,
  RunStoreInspection,
  RuntimeResult,
} from '../../domains/runtime/types.js';
import { parseWorkflowPackage } from '../../domains/workflow-contract/package.js';
import { loadDeliveryPolicy } from '../../platform/delivery/config.js';
import { loadProjectConfig } from '../../platform/project-configuration/file-config.js';
import { execute } from '../../platform/process/execute.js';
import type { ProvenanceCheck } from '../../platform/provenance/check.js';
import type {
  PlatformEventReplayResult,
  PlatformEventStatusView,
} from '../../domains/platform-events/types.js';
import {
  booleanFlag,
  integerFlag,
  parseArguments,
  stringFlag,
  type ParsedArguments,
} from './arguments.js';
import { failureEnvelope, successEnvelope, type CliEnvelope } from './envelope.js';
import type { EvidenceCoordinator } from '../../services/evidence-coordinator.js';
import type { BrowserMaintenance } from '../../services/browser-maintenance.js';
import { bootBootstrapComposition, bootProjectComposition } from '../boot/bootstrap.js';
import { reviewHumanDecision } from './human-decision.js';
import { reviewProjectConfigurationDecision } from './project-configuration-decision.js';
import { startRunnerApplication } from '../runner/application.js';
import type { PostMergeReconciliationResult } from '../../services/post-merge-coordinator.js';
import type { SpecificationApprovalState } from '../../domains/specification/types.js';
import { inspectPublishedChangeBranch } from '../../platform/git/change-branch.js';
import { reviewSpecificationApproval } from './specification-approval-decision.js';
import { changeProjection, renderChangeProjection } from './change-run-view.js';
import type { ConsistencyReconciliationResult } from '../../services/consistency-reconciler.js';

const DIST_DIR = path.dirname(fileURLToPath(import.meta.url));
const PRODUCT_ROOT =
  path.basename(DIST_DIR) === 'dist'
    ? path.resolve(DIST_DIR, '..')
    : path.resolve(DIST_DIR, '..', '..');
const USAGE =
  'Usage: repoctopus project <probe|detect|prepare|review> | skill <list|get|project> | spec <inspect|validate|approval prepare|approval status|approval review> | evidence <plan|run|status|resume|inspect|clean> | run <start|status|next|verify|decide|record|resume|work-claim|work-outcome|work-validate|archive-prepare|archive-publish|archive-refresh|archive-verify|archive-complete> | change reconcile | runner start | post-merge reconcile | delivery <checkpoint|prepare|status|publish|resume|refresh|migration-plan> | event <status|replay|retry> | approval review | browser <doctor|install> | doctor';

function defaultWorkflowPath(): string {
  return path.resolve(DIST_DIR, '..', 'workflows', 'foundation.yaml');
}

function nextActions(status: RunStatusView): string[] {
  const lifecycle = status.changeLifecycle;
  if (lifecycle) {
    const work = lifecycle.currentWork?.kind;
    if (lifecycle.phase === 'design' && lifecycle.status === 'waiting') {
      return ['repoctopus run decide --run <run-id>'];
    }
    if (work === 'evidence.verify') return ['repoctopus run verify --run <run-id>'];
    if (work === 'delivery.prepare') return ['repoctopus run archive-publish --run <run-id>'];
    if (work === 'delivery.await-merge') return ['repoctopus run archive-refresh --run <run-id>'];
    if (work === 'delivery.verify-merged') {
      return ['repoctopus run archive-verify --run <run-id>'];
    }
    if (work === 'specification.archive') {
      return ['repoctopus run archive-complete --run <run-id>'];
    }
    return lifecycle.nextActions.length > 0 ? ['repoctopus run next --run <run-id>'] : [];
  }
  if (status.state.status === 'running') return ['repoctopus run next --run <run-id>'];
  if (status.state.status === 'waiting') {
    if (status.changeLifecycle?.waitCondition?.kind === 'human-decision') {
      return ['repoctopus run decide --run <run-id>'];
    }
    const evidence = status.nextAction?.evidenceProfile ? ' --evidence-attempt <attempt-id>' : '';
    return [
      `repoctopus run record --run <run-id> --action <action-id> --status succeeded --summary <text>${evidence}`,
    ];
  }
  return [];
}

function evidenceBundleIds(parsed: ParsedArguments): string[] {
  const value = stringFlag(parsed, 'evidence-bundles', { required: true })!;
  const ids = value.split(',').map((item) => item.trim());
  if (ids.length === 0 || ids.some((item) => item.length === 0)) {
    throw new Error('--evidence-bundles must contain comma-separated Bundle IDs');
  }
  return [...new Set(ids)].sort();
}

async function deliveryInputs(parsed: ParsedArguments): Promise<{
  workspace: string;
  config: EffectiveProjectConfig;
  intent: DeliveryIntentV3;
  policy: DeliveryPolicy;
}> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const intentFile = path.resolve(stringFlag(parsed, 'intent', { required: true })!);
  const policyFile = path.resolve(
    stringFlag(parsed, 'policy', { fallback: path.join(workspace, 'repoctopus.yaml') })!,
  );
  const [config, intentSource, policy] = await Promise.all([
    loadProjectConfig(workspace),
    readFile(intentFile, 'utf8'),
    loadDeliveryPolicy(policyFile),
  ]);
  return {
    workspace,
    config,
    intent: parseDeliveryIntentV3(parse(intentSource)),
    policy,
  };
}

async function assertCommittedReport(
  reportFile: string,
  project: ProjectSnapshot,
  intent: DeliveryIntentV3,
): Promise<void> {
  const selected = new Set(intent.businessDeliveries.map((item) => item.repositoryId));
  const repository = project.repositories.find((item) => {
    if (!selected.has(item.id)) return false;
    const relative = path.relative(item.path, reportFile);
    return (
      relative !== '' &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  });
  if (!repository) {
    throw new Error(
      'Verification report must be inside a repository selected by the delivery intent',
    );
  }
  const relative = path.relative(repository.path, reportFile);
  await execute('git', ['ls-files', '--error-unmatch', '--', relative], { cwd: repository.path });
}

async function deliveryProject(
  app: Awaited<ReturnType<typeof bootProjectComposition>>,
  input: { workspace: string; config: EffectiveProjectConfig },
): Promise<ProjectSnapshot> {
  return app.context.commandRouter.execute('workspace.snapshot', {
    workspaceId: input.config.shared.workspace.id,
    workspaceRoot: input.workspace,
    workspaceRepositoryId: input.config.shared.workspace.repositoryId,
    repositories: input.config.repositories.map((repository) => ({
      id: repository.id,
      path: repository.resolvedPath,
    })),
  });
}

async function currentWorkspaceSnapshot(
  app: Awaited<ReturnType<typeof bootProjectComposition>>,
  workspace: string,
): Promise<ProjectSnapshot> {
  return deliveryProject(app, { workspace, config: await loadProjectConfig(workspace) });
}

function deliveryNextActions(status: DeliveryState | DeliveryStateV3): string[] {
  if (status.status === 'awaiting_approval') {
    return [`repoctopus approval review --change ${status.changeId}`];
  }
  if (status.status === 'approved' || status.status === 'partially_published') {
    return [
      `repoctopus delivery publish --change ${status.changeId} --intent <file> --policy <file> --report <file>`,
    ];
  }
  if (status.status === 'in_review' && status.schemaVersion === 2)
    return [`repoctopus delivery refresh --change ${status.changeId}`];
  return [];
}

async function deliveryCheckpoint(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const input = await deliveryInputs(parsed);
  const app = await bootProjectComposition(PRODUCT_ROOT, input.workspace);
  try {
    const result = await app.context.commandRouter.execute('delivery.checkpoint', {
      project: await deliveryProject(app, input),
      intent: input.intent,
      policy: input.policy,
    });
    return successEnvelope({ command: 'delivery checkpoint', result });
  } finally {
    await app.close();
  }
}

async function deliveryPrepare(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const input = await deliveryInputs(parsed);
  const reportFile = path.resolve(stringFlag(parsed, 'report', { required: true })!);
  const app = await bootProjectComposition(PRODUCT_ROOT, input.workspace);
  try {
    const project = await deliveryProject(app, input);
    await assertCommittedReport(reportFile, project, input.intent);
    const report = await readFile(reportFile, 'utf8');
    const result = await app.context.commandRouter.execute<
      unknown,
      DeliveryState | DeliveryStateV3
    >('delivery.prepare', {
      project,
      intent: input.intent,
      policy: input.policy,
      reportContents: report,
      evidenceBundleIds: evidenceBundleIds(parsed),
    });
    return successEnvelope({
      command: 'delivery prepare',
      result,
      nextActions: deliveryNextActions(result),
    });
  } finally {
    await app.close();
  }
}

async function deliveryStatus(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const changeId = stringFlag(parsed, 'change', { required: true })!;
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const result = await app.context.commandRouter.execute<
      unknown,
      DeliveryState | DeliveryStateV3
    >('delivery.status', { changeId });
    return successEnvelope({
      command: 'delivery status',
      result,
      nextActions: deliveryNextActions(result),
    });
  } finally {
    await app.close();
  }
}

async function eventStatus(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const envelopeId = stringFlag(parsed, 'envelope', { required: true })!;
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const result = await app.context.commandRouter.execute<
      { envelopeId: string },
      PlatformEventStatusView
    >('event.status', { envelopeId });
    return successEnvelope({ command: 'event status', result });
  } finally {
    await app.close();
  }
}

async function eventReplay(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const file = path.resolve(stringFlag(parsed, 'file', { required: true })!);
  const envelope = JSON.parse(await readFile(file, 'utf8')) as unknown;
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const result = await app.context.commandRouter.execute<
      { envelope: unknown },
      PlatformEventReplayResult
    >('event.replay', { envelope });
    return successEnvelope({
      command: 'event replay',
      result,
      nextActions: [`repoctopus event status --envelope ${result.event.envelopeId}`],
    });
  } finally {
    await app.close();
  }
}

async function eventRetry(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const envelopeId = stringFlag(parsed, 'envelope', { required: true })!;
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const result = await app.context.commandRouter.execute<
      { envelopeId: string },
      PlatformEventStatusView
    >('event.retry', { envelopeId });
    return successEnvelope({ command: 'event retry', result });
  } finally {
    await app.close();
  }
}

async function approvalReview(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Human approval requires an interactive terminal or a trusted IDE Adapter');
  }
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const changeId = stringFlag(parsed, 'change', { required: true })!;
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const state = await app.context.commandRouter.execute<unknown, DeliveryState | DeliveryStateV3>(
      'delivery.status',
      { changeId },
    );
    if (state.status !== 'awaiting_approval' || !state.decisionRequest) {
      throw new Error(`Delivery is not awaiting approval: ${changeId}`);
    }
    const selected = await reviewHumanDecision({
      request: state.decisionRequest,
      input: process.stdin,
      output: process.stdout,
    });
    const result = await app.context.commandRouter.execute<
      unknown,
      DeliveryState | DeliveryStateV3
    >('delivery.decide', {
      changeId,
      response: {
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'HumanDecisionResponse',
        requestId: state.decisionRequest.requestId,
        snapshotDigest: state.decisionRequest.snapshotDigest,
        decision: selected.decision,
        ...(selected.comment ? { comment: selected.comment } : {}),
      },
      actor: {
        subject: userInfo().username,
        provider: 'interactive-cli',
        sessionId: state.decisionRequest.requestId,
      },
    });
    return successEnvelope({
      command: 'approval review',
      result,
      nextActions: deliveryNextActions(result),
    });
  } finally {
    await app.close();
  }
}

async function deliveryPublish(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const input = await deliveryInputs(parsed);
  const changeId = stringFlag(parsed, 'change', { required: true })!;
  if (input.intent.changeId !== changeId)
    throw new Error('--change does not match the delivery intent');
  const report = await readFile(
    path.resolve(stringFlag(parsed, 'report', { required: true })!),
    'utf8',
  );
  const app = await bootProjectComposition(PRODUCT_ROOT, input.workspace);
  try {
    const result = await app.context.commandRouter.execute<
      unknown,
      DeliveryState | DeliveryStateV3
    >('delivery.publish', {
      project: await deliveryProject(app, input),
      intent: input.intent,
      policy: input.policy,
      reportContents: report,
      evidenceBundleIds: evidenceBundleIds(parsed),
    });
    return successEnvelope({
      command: 'delivery publish',
      result,
      nextActions: deliveryNextActions(result),
    });
  } finally {
    await app.close();
  }
}

async function deliveryRefresh(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const changeId = stringFlag(parsed, 'change', { required: true })!;
  const policy = await loadDeliveryPolicy(
    path.resolve(
      stringFlag(parsed, 'policy', { fallback: path.join(workspace, 'repoctopus.yaml') })!,
    ),
  );
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const result = await app.context.commandRouter.execute<
      unknown,
      DeliveryState | DeliveryStateV3
    >('delivery.refresh', { changeId, policy });
    return successEnvelope({
      command: 'delivery refresh',
      result,
      nextActions: deliveryNextActions(result),
    });
  } finally {
    await app.close();
  }
}

async function deliveryMigrationPlan(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const changeId = stringFlag(parsed, 'change', { required: true })!;
  const policy = await loadDeliveryPolicy(
    path.resolve(
      stringFlag(parsed, 'policy', { fallback: path.join(workspace, 'repoctopus.yaml') })!,
    ),
  );
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const result = await app.context.commandRouter.execute<unknown, DeliveryV2MigrationPlan>(
      'delivery.migration-plan',
      { changeId, policy },
    );
    return successEnvelope({ command: 'delivery migration-plan', result });
  } finally {
    await app.close();
  }
}

function skillAudience(parsed: ParsedArguments): 'model' | 'user' {
  const audience = stringFlag(parsed, 'audience', { fallback: 'user' });
  if (audience !== 'model' && audience !== 'user') {
    throw new Error('--audience must be model or user');
  }
  return audience;
}

async function skillList(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const result = await app.context.commandRouter.execute('skill.list', {
      cwd: workspace,
      audience: skillAudience(parsed),
    });
    return successEnvelope({ command: 'skill list', result });
  } finally {
    await app.close();
  }
}

async function skillGet(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const result = await app.context.commandRouter.execute('skill.get', {
      cwd: workspace,
      audience: skillAudience(parsed),
      name: stringFlag(parsed, 'name', { required: true })!,
      ...(stringFlag(parsed, 'run') ? { runId: stringFlag(parsed, 'run') } : {}),
    });
    return successEnvelope({ command: 'skill get', result });
  } finally {
    await app.close();
  }
}

async function skillProject(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const target = stringFlag(parsed, 'target', { required: true });
  if (target !== 'codex' && target !== 'opencode') {
    throw new Error('--target must be codex or opencode');
  }
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const result = await app.context.commandRouter.execute('skill.project', {
      cwd: workspace,
      target,
    });
    return successEnvelope({ command: 'skill project', result });
  } finally {
    await app.close();
  }
}

async function specificationInspect(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const changeId = stringFlag(parsed, 'change', { required: true })!;
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const result = await app.context.commandRouter.execute('specification.inspect', { changeId });
    return successEnvelope({ command: 'spec inspect', result });
  } finally {
    await app.close();
  }
}

async function specificationValidate(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const changeId = stringFlag(parsed, 'change', { required: true })!;
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const result = await app.context.commandRouter.execute<
      { changeId: string; strict: boolean },
      { valid: boolean }
    >('specification.validate', {
      changeId,
      strict: true,
      ...(stringFlag(parsed, 'run') ? { runId: stringFlag(parsed, 'run') } : {}),
    });
    if (!result.valid) throw new Error(`Specification validation failed: ${changeId}`);
    return successEnvelope({ command: 'spec validate', result });
  } finally {
    await app.close();
  }
}

function qualifiedSha256(value: string, label: string): `sha256:${string}` {
  const qualified = value.startsWith('sha256:') ? value : `sha256:${value}`;
  if (!/^sha256:[a-f0-9]{64}$/u.test(qualified)) {
    throw new Error(`${label} is not a SHA-256 digest`);
  }
  return qualified as `sha256:${string}`;
}

async function specificationApprovalPrepare(
  parsed: ParsedArguments,
): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const changeId = stringFlag(parsed, 'change', { required: true })!;
  const sourceBranch = stringFlag(parsed, 'branch', { required: true })!;
  const targetBranch = stringFlag(parsed, 'target', { required: true })!;
  const remote = stringFlag(parsed, 'remote', { fallback: 'origin' })!;
  const config = await loadProjectConfig(workspace);
  const workspaceRepository = config.repositories.find(
    (repository) => repository.id === config.shared.workspace.repositoryId,
  );
  if (!workspaceRepository) throw new Error('Workspace Repository is not configured');
  const changeBranch = await inspectPublishedChangeBranch({
    repositoryPath: workspaceRepository.resolvedPath,
    repositoryId: workspaceRepository.id,
    remote,
    sourceBranch,
    targetBranch,
  });
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const result = await app.context.commandRouter.execute<unknown, SpecificationApprovalState>(
      'specification.approval.prepare',
      {
        changeId,
        changeBranch,
        compositionDigest: app.composition.compositionDigest,
        projectConfigDigest: qualifiedSha256(config.effectiveDigest, 'Project configuration'),
      },
    );
    return successEnvelope({
      command: 'spec approval prepare',
      result,
      nextActions:
        result.status === 'awaiting_approval'
          ? [`repoctopus spec approval review --change ${changeId}`]
          : [],
    });
  } finally {
    await app.close();
  }
}

async function specificationApprovalStatus(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const changeId = stringFlag(parsed, 'change', { required: true })!;
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const result = await app.context.commandRouter.execute('specification.approval.status', {
      changeId,
    });
    return successEnvelope({ command: 'spec approval status', result });
  } finally {
    await app.close();
  }
}

async function specificationApprovalReview(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Human approval requires an interactive terminal or a trusted IDE Adapter');
  }
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const changeId = stringFlag(parsed, 'change', { required: true })!;
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const state = await app.context.commandRouter.execute<
      unknown,
      SpecificationApprovalState | null
    >('specification.approval.status', { changeId });
    if (!state || state.status !== 'awaiting_approval') {
      throw new Error(`Specification is not awaiting approval: ${changeId}`);
    }
    const selected = await reviewSpecificationApproval({
      request: state.decisionRequest,
      input: process.stdin,
      output: process.stdout,
    });
    const result = await app.context.commandRouter.execute<unknown, SpecificationApprovalState>(
      'specification.approval.decide',
      {
        changeId,
        response: {
          apiVersion: 'repoctopus/v1alpha1',
          kind: 'HumanDecisionResponse',
          requestId: state.decisionRequest.requestId,
          proposalHash: state.decisionRequest.proposalHash,
          decision: selected.decision,
          ...(selected.comment ? { comment: selected.comment } : {}),
        },
        actor: {
          actorId: userInfo().username,
          source: 'cli',
          authenticated: true,
        },
      },
    );
    return successEnvelope({ command: 'spec approval review', result });
  } finally {
    await app.close();
  }
}

async function projectDetect(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const scanRoot = path.resolve(stringFlag(parsed, 'scan-root', { required: true })!);
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const skippedPointerRepositoryIds = stringFlag(parsed, 'skip-pointer')
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const app = await bootBootstrapComposition(PRODUCT_ROOT);
  try {
    const result = await app.context.commandRouter.execute('project.detect', {
      workspace,
      scanRoot,
      ...(stringFlag(parsed, 'store') ? { storeId: stringFlag(parsed, 'store') } : {}),
      ...(skippedPointerRepositoryIds && skippedPointerRepositoryIds.length > 0
        ? { skippedPointerRepositoryIds }
        : {}),
    });
    return successEnvelope({
      command: 'project detect',
      result,
      nextActions: [
        'review unresolved items and let an Agent prepare a complete candidate configuration',
        'submit the completed candidate through a trusted human decision channel',
      ],
    });
  } finally {
    await app.close();
  }
}

async function projectPrepare(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const draftFile = path.resolve(stringFlag(parsed, 'draft', { required: true })!);
  const candidateFile = path.resolve(stringFlag(parsed, 'candidate', { required: true })!);
  const completedCandidate = parse(await readFile(candidateFile, 'utf8')) as unknown;
  const app = await bootBootstrapComposition(PRODUCT_ROOT);
  try {
    const result = await app.context.commandRouter.execute<unknown, { file: string }>(
      'project.prepare',
      { workspace, draftFile, completedCandidate },
    );
    return successEnvelope({
      command: 'project prepare',
      result,
      nextActions: [`repoctopus project review --workspace ${workspace} --request ${result.file}`],
    });
  } finally {
    await app.close();
  }
}

async function projectReview(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      'Project configuration approval requires an interactive terminal or a trusted IDE Adapter',
    );
  }
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const decisionFile = path.resolve(stringFlag(parsed, 'request', { required: true })!);
  const app = await bootBootstrapComposition(PRODUCT_ROOT);
  try {
    const request = await app.context.commandRouter.execute<
      { workspace: string; decisionFile: string },
      Parameters<typeof reviewProjectConfigurationDecision>[0]['request']
    >('project.decision.load', { workspace, decisionFile });
    const selected = await reviewProjectConfigurationDecision({
      request,
      input: process.stdin,
      output: process.stdout,
    });
    const result = await app.context.commandRouter.execute('project.decision.apply', {
      workspace,
      decisionFile,
      response: {
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'HumanDecisionResponse',
        requestId: request.requestId,
        snapshotDigest: request.snapshotDigest,
        decision: selected.decision,
        ...(selected.comment ? { comment: selected.comment } : {}),
      },
      actor: {
        actorId: userInfo().username,
        source: 'cli',
        authenticated: true,
      },
      timestamp: new Date().toISOString(),
    });
    return successEnvelope({ command: 'project review', result });
  } finally {
    await app.close();
  }
}

async function evidencePlan(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const profile = stringFlag(parsed, 'profile', { fallback: 'verify' })!;
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const result = await app.context.commandRouter.execute('evidence.plan', {
      profileId: profile,
    });
    return successEnvelope({ command: 'evidence plan', result });
  } finally {
    await app.close();
  }
}

async function evidenceRun(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const profile = stringFlag(parsed, 'profile', { fallback: 'verify' })!;
  const requestedAttemptId = stringFlag(parsed, 'attempt');
  const workflowRunId = stringFlag(parsed, 'workflow-run') ?? null;
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const result = await app.context.commandRouter.execute<
      { profileId: string; attemptId?: string; workflowRunId: string | null },
      Awaited<ReturnType<EvidenceCoordinator['run']>>
    >('evidence.run', {
      profileId: profile,
      ...(requestedAttemptId ? { attemptId: requestedAttemptId } : {}),
      workflowRunId,
    });
    return successEnvelope({
      command: 'evidence run',
      runId: result.attempt.attemptId,
      result,
      nextActions: [
        `repoctopus evidence inspect --workspace ${workspace} --attempt ${result.attempt.attemptId}`,
      ],
    });
  } finally {
    await app.close();
  }
}

async function evidenceStatus(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const attemptId = stringFlag(parsed, 'attempt', { required: true })!;
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const result = await app.context.commandRouter.execute('evidence.status', { attemptId });
    return successEnvelope({ command: 'evidence status', runId: attemptId, result });
  } finally {
    await app.close();
  }
}

async function evidenceResume(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const attemptId = stringFlag(parsed, 'attempt', { required: true })!;
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const result = await app.context.commandRouter.execute('evidence.resume', { attemptId });
    return successEnvelope({ command: 'evidence resume', runId: attemptId, result });
  } finally {
    await app.close();
  }
}

async function evidenceInspect(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const attemptId = stringFlag(parsed, 'attempt', { required: true })!;
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const result = await app.context.commandRouter.execute('evidence.inspect', { attemptId });
    return successEnvelope({ command: 'evidence inspect', runId: attemptId, result });
  } finally {
    await app.close();
  }
}

async function evidenceClean(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const maxAgeDays = integerFlag(parsed, 'max-age-days', { fallback: 30, minimum: 0 })!;
  const maxBytes = integerFlag(parsed, 'max-bytes', {
    fallback: 1024 * 1024 * 1024,
    minimum: 0,
  })!;
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const result = await app.context.commandRouter.execute('evidence.clean', {
      maxAgeMs: maxAgeDays * 24 * 60 * 60 * 1000,
      maxBytes,
    });
    return successEnvelope({ command: 'evidence clean', result });
  } finally {
    await app.close();
  }
}

async function runStart(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const reconciliation = await app.context.commandRouter.execute<
      Record<string, never>,
      ConsistencyReconciliationResult
    >('change.reconcile', {});
    const changeId = stringFlag(parsed, 'change');
    if (changeId) {
      const config = await loadProjectConfig(workspace);
      const projectSnapshot = await deliveryProject(app, { workspace, config });
      const result = await app.context.commandRouter.execute<
        {
          workspaceId: string;
          workspaceRepositoryId: string;
          repositoryIds: string[];
          changeId: string;
          generation: number;
          targetBranch: string;
          remote: string;
          projectSnapshot: ProjectSnapshot;
          projectConfigDigest: `sha256:${string}`;
          verificationProfileId: string;
        },
        RuntimeResult<RunStatusView>
      >('run.change.start', {
        workspaceId: config.shared.workspace.id,
        workspaceRepositoryId: config.shared.workspace.repositoryId,
        repositoryIds: config.shared.repositories.map((repository) => repository.id),
        changeId,
        generation: integerFlag(parsed, 'generation', { fallback: 1, minimum: 1 })!,
        targetBranch: stringFlag(parsed, 'target', { required: true })!,
        remote: stringFlag(parsed, 'remote', { fallback: 'origin' })!,
        projectSnapshot,
        projectConfigDigest: qualifiedSha256(config.effectiveDigest, 'Project configuration'),
        verificationProfileId: stringFlag(parsed, 'profile', { fallback: 'verify' })!,
      });
      return successEnvelope({
        command: 'run start',
        runId: result.value.state.runId,
        result: result.value,
        diagnostics: [...result.diagnostics, ...reconciliation.diagnostics],
        nextActions: nextActions(result.value),
      });
    }
    const workflowPath = path.resolve(
      stringFlag(parsed, 'workflow', { fallback: defaultWorkflowPath() })!,
    );
    const [source, projectSnapshot] = await Promise.all([
      readFile(workflowPath, 'utf8'),
      currentWorkspaceSnapshot(app, workspace),
    ]);
    const requestedRunId = stringFlag(parsed, 'run');
    const result = await app.context.commandRouter.execute<
      {
        workflow: ReturnType<typeof parseWorkflowPackage>;
        projectSnapshot: ProjectSnapshot;
        workflowSource: string;
        runId?: string;
      },
      RuntimeResult<RunStatusView>
    >('run.start', {
      workflow: parseWorkflowPackage(source),
      projectSnapshot,
      workflowSource: workflowPath,
      ...(requestedRunId ? { runId: requestedRunId } : {}),
    });
    return successEnvelope({
      command: 'run start',
      runId: result.value.state.runId,
      result: result.value,
      diagnostics: [
        ...result.diagnostics,
        ...(reconciliation.checked > 0
          ? [
              {
                level:
                  reconciliation.diagnostics.length > 0 ? ('warning' as const) : ('info' as const),
                code: 'consistency.reconciliation',
                message: `启动前一致性检查 ${reconciliation.checked} 个 change：无变化 ${reconciliation.unchanged}，待语义审查 ${reconciliation.reviewRequests.length}`,
              },
            ]
          : []),
        ...reconciliation.diagnostics,
      ],
      nextActions: nextActions(result.value),
    });
  } finally {
    await app.close();
  }
}

async function changeReconcile(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const changeId = stringFlag(parsed, 'change');
    const result = await app.context.commandRouter.execute<
      { changeId?: string },
      ConsistencyReconciliationResult
    >('change.reconcile', {
      ...(changeId ? { changeId } : {}),
    });
    return successEnvelope({
      command: 'change reconcile',
      result,
      diagnostics: result.diagnostics,
    });
  } finally {
    await app.close();
  }
}

async function postMergeReconcile(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    if (!app.composition.entries.some((entry) => entry.id === 'post-merge-command')) {
      throw new Error('Post-merge reconciliation requires postMerge project configuration');
    }
    const result = await app.context.commandRouter.execute<
      Record<string, never>,
      PostMergeReconciliationResult
    >('post-merge.reconcile', {});
    return successEnvelope({
      command: 'post-merge reconcile',
      result,
      diagnostics:
        result.failed > 0 || result.blocked > 0
          ? [
              {
                level: 'warning',
                code: 'post-merge.reconciliation-incomplete',
                message: `补偿检查存在未收敛结果：阻断 ${result.blocked}，失败 ${result.failed}`,
              },
            ]
          : [],
    });
  } finally {
    await app.close();
  }
}

async function runStatus(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const runId = stringFlag(parsed, 'run', { required: true })!;
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const status = await app.context.commandRouter.execute<{ runId: string }, RunStatusView>(
      'run.status',
      { runId },
    );
    return successEnvelope({
      command: 'run status',
      runId,
      result: status,
      nextActions: nextActions(status),
    });
  } finally {
    await app.close();
  }
}

async function runNext(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const runId = stringFlag(parsed, 'run', { required: true })!;
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const result = await app.context.commandRouter.execute<
      { runId: string },
      RuntimeResult<RunStatusView>
    >('run.next', { runId });
    return successEnvelope({
      command: 'run next',
      runId,
      result: result.value,
      diagnostics: result.diagnostics,
      nextActions: nextActions(result.value),
    });
  } finally {
    await app.close();
  }
}

async function runVerify(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const runId = stringFlag(parsed, 'run', { required: true })!;
  const attemptId = stringFlag(parsed, 'attempt');
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const result = await app.context.commandRouter.execute('run.work.verify', {
      runId,
      ...(attemptId ? { attemptId } : {}),
    });
    const value = result as RuntimeResult<{ run: RunStatusView }>;
    return successEnvelope({
      command: 'run verify',
      runId,
      result: value.value,
      diagnostics: value.diagnostics,
      nextActions: nextActions(value.value.run),
    });
  } finally {
    await app.close();
  }
}

async function archiveRuntimeInputs(parsed: ParsedArguments) {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const policyFile = path.resolve(
    stringFlag(parsed, 'policy', { fallback: path.join(workspace, 'repoctopus.yaml') })!,
  );
  const [config, policy] = await Promise.all([
    loadProjectConfig(workspace),
    loadDeliveryPolicy(policyFile),
  ]);
  return { workspace, config, policy };
}

async function runArchivePrepare(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const { workspace, intent, policy } = await deliveryInputs(parsed);
  const runId = stringFlag(parsed, 'run', { required: true })!;
  const attemptId = stringFlag(parsed, 'attempt', { required: true })!;
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const result = await app.context.commandRouter.execute('run.archive.prepare', {
      runId,
      attemptId,
      intent,
      policy,
    });
    return successEnvelope({ command: 'run archive-prepare', runId, result });
  } finally {
    await app.close();
  }
}

async function runArchivePublish(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const { workspace, config, policy } = await archiveRuntimeInputs(parsed);
  const runId = stringFlag(parsed, 'run', { required: true })!;
  const attempt = integerFlag(parsed, 'attempt', { fallback: 1, minimum: 1 })!;
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const project = await deliveryProject(app, { workspace, config });
    const result = await app.context.commandRouter.execute('run.archive.publish', {
      runId,
      attempt,
      project,
      policy,
      executor: {
        actorId: userInfo().username,
        runnerId: `cli:${process.pid}`,
        source: 'cli',
        authenticated: true,
      },
    });
    return successEnvelope({ command: 'run archive-publish', runId, result });
  } finally {
    await app.close();
  }
}

async function runArchiveRefresh(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const { workspace, policy } = await archiveRuntimeInputs(parsed);
  const runId = stringFlag(parsed, 'run', { required: true })!;
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const result = await app.context.commandRouter.execute('run.archive.refresh', {
      runId,
      policy,
      source: 'active-check',
    });
    return successEnvelope({ command: 'run archive-refresh', runId, result });
  } finally {
    await app.close();
  }
}

async function runArchiveVerify(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const { workspace, config } = await archiveRuntimeInputs(parsed);
  const runId = stringFlag(parsed, 'run', { required: true })!;
  const profileId = stringFlag(parsed, 'profile', { fallback: 'verify' })!;
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const result = await app.context.commandRouter.execute('run.archive.verify-merged', {
      runId,
      profileId,
      sources: config.repositories.map((repository) => ({
        repositoryId: repository.id,
        path: repository.resolvedPath,
      })),
    });
    return successEnvelope({ command: 'run archive-verify', runId, result });
  } finally {
    await app.close();
  }
}

async function runArchiveComplete(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const runId = stringFlag(parsed, 'run', { required: true })!;
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const result = await app.context.commandRouter.execute('run.archive.complete', { runId });
    return successEnvelope({ command: 'run archive-complete', runId, result });
  } finally {
    await app.close();
  }
}

async function runWorkClaim(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const runId = stringFlag(parsed, 'run', { required: true })!;
  const adapter = stringFlag(parsed, 'adapter', { fallback: 'process' })!;
  const attempt = integerFlag(parsed, 'attempt', { fallback: 1, minimum: 1 })!;
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const result = await app.context.commandRouter.execute('run.work.claim', {
      runId,
      adapter,
      attempt,
      executor: {
        actorId: userInfo().username,
        runnerId: stringFlag(parsed, 'runner', { fallback: `cli:${process.pid}` })!,
        source: 'cli',
        authenticated: true,
      },
    });
    return successEnvelope({ command: 'run work-claim', runId, result });
  } finally {
    await app.close();
  }
}

async function runWorkOutcome(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const runId = stringFlag(parsed, 'run', { required: true })!;
  const status = stringFlag(parsed, 'status', { required: true });
  if (status !== 'succeeded' && status !== 'failed') {
    throw new Error('--status must be succeeded or failed');
  }
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const result = await app.context.commandRouter.execute('run.work.outcome', {
      schemaVersion: 1,
      outcomeId: randomUUID(),
      runId,
      workId: stringFlag(parsed, 'work', { required: true })!,
      attempt: integerFlag(parsed, 'attempt', { required: true, minimum: 1 })!,
      claimToken: qualifiedSha256(
        stringFlag(parsed, 'claim-token', { required: true })!,
        'Claim token',
      ),
      inputDigest: qualifiedSha256(
        stringFlag(parsed, 'input-digest', { required: true })!,
        'Work input digest',
      ),
      status,
      summary: stringFlag(parsed, 'summary', { required: true })!,
    });
    return successEnvelope({ command: 'run work-outcome', runId, result });
  } finally {
    await app.close();
  }
}

async function runWorkValidate(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const runId = stringFlag(parsed, 'run', { required: true })!;
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const result = await app.context.commandRouter.execute('run.work.validate', {
      runId,
      receiptId: stringFlag(parsed, 'receipt', { required: true })!,
    });
    return successEnvelope({ command: 'run work-validate', runId, result });
  } finally {
    await app.close();
  }
}

async function runDecide(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Human approval requires an interactive terminal or a trusted IDE Adapter');
  }
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const runId = stringFlag(parsed, 'run', { required: true })!;
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const status = await app.context.commandRouter.execute<{ runId: string }, RunStatusView>(
      'run.status',
      { runId },
    );
    const lifecycle = status.changeLifecycle;
    if (
      !lifecycle ||
      lifecycle.phase !== 'design' ||
      lifecycle.status !== 'waiting' ||
      lifecycle.waitCondition?.kind !== 'human-decision'
    ) {
      throw new Error('Change Run is not waiting for a Design Human Decision');
    }
    const approval = await app.context.commandRouter.execute<
      { changeId: string },
      SpecificationApprovalState | null
    >('specification.approval.status', { changeId: lifecycle.identity.changeId });
    if (
      !approval ||
      approval.status !== 'awaiting_approval' ||
      approval.decisionRequest.requestId !== lifecycle.waitCondition.requestId ||
      approval.decisionRequest.proposalHash !== lifecycle.waitCondition.proposalDigest
    ) {
      throw new Error('Change Run Design proposal is stale or unavailable');
    }
    const selected = await reviewSpecificationApproval({
      request: approval.decisionRequest,
      input: process.stdin,
      output: process.stdout,
    });
    const result = await app.context.commandRouter.execute<unknown, SpecificationApprovalState>(
      'run.change.decide',
      {
        runId,
        response: {
          apiVersion: 'repoctopus/v1alpha1',
          kind: 'HumanDecisionResponse',
          requestId: approval.decisionRequest.requestId,
          proposalHash: approval.decisionRequest.proposalHash,
          decision: selected.decision,
          ...(selected.comment ? { comment: selected.comment } : {}),
        },
        actor: {
          actorId: userInfo().username,
          source: 'cli',
          authenticated: true,
        },
      },
    );
    return successEnvelope({
      command: 'run decide',
      runId,
      result,
      nextActions: [`repoctopus run next --run ${runId}`],
    });
  } finally {
    await app.close();
  }
}

async function runRecord(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const runId = stringFlag(parsed, 'run', { required: true })!;
  const status = stringFlag(parsed, 'status', { required: true });
  if (status !== 'succeeded' && status !== 'failed') {
    throw new Error('--status must be succeeded or failed');
  }
  const requestedEventId = stringFlag(parsed, 'event-id');
  const evidenceAttemptId = stringFlag(parsed, 'evidence-attempt');
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const result = await app.context.commandRouter.execute<
      {
        runId: string;
        actionId: string;
        status: 'succeeded' | 'failed';
        summary: string;
        eventId?: string;
        evidenceAttemptId?: string;
      },
      RuntimeResult<RunStatusView>
    >('run.record', {
      runId,
      actionId: stringFlag(parsed, 'action', { required: true })!,
      status,
      summary: stringFlag(parsed, 'summary', { required: true })!,
      ...(requestedEventId ? { eventId: requestedEventId } : {}),
      ...(evidenceAttemptId ? { evidenceAttemptId } : {}),
    });
    return successEnvelope({
      command: 'run record',
      runId,
      result: result.value,
      diagnostics: result.diagnostics,
      nextActions: nextActions(result.value),
    });
  } finally {
    await app.close();
  }
}

async function runResume(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const runId = stringFlag(parsed, 'run', { required: true })!;
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const currentProjectSnapshot = await currentWorkspaceSnapshot(app, workspace);
    const result = await app.context.commandRouter.execute<
      { runId: string; currentProjectSnapshot: ProjectSnapshot },
      RuntimeResult<ResumeView>
    >('run.resume', { runId, currentProjectSnapshot });
    return successEnvelope({
      command: 'run resume',
      runId,
      result: result.value,
      diagnostics: result.diagnostics,
      nextActions: result.value.reconciliation.changed
        ? ['inspect reconciliation and start a new run or restore the repository state']
        : nextActions(result.value),
    });
  } finally {
    await app.close();
  }
}

async function doctor(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const runId = stringFlag(parsed, 'run', { required: true })!;
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const [{ state, checkpoint, trajectory, cursor, pendingTransition }, provenance] =
      await Promise.all([
        app.context.commandRouter.execute<{ runId: string }, RunStoreInspection>('run.inspect', {
          runId,
        }),
        app.context.commandRouter.execute<Record<string, never>, ProvenanceCheck>(
          'provenance.check',
          {},
        ),
      ]);
    if (!state || !checkpoint) {
      throw new Error(
        pendingTransition
          ? 'Run has an incomplete transition; use run resume to recover it'
          : 'Run state or checkpoint is missing',
      );
    }
    if (checkpoint.stateVersion !== state.stateVersion) {
      throw new Error('Checkpoint stateVersion does not match Run state');
    }
    if (checkpoint.trajectoryOffset !== trajectory.length) {
      throw new Error('Checkpoint trajectoryOffset does not match Trajectory length');
    }
    if (cursor.trajectoryOffset > trajectory.length) {
      throw new Error('Telemetry cursor is beyond the Trajectory');
    }
    if (!provenance.valid) throw new Error(provenance.findings.join('\n'));
    return successEnvelope({
      command: 'doctor',
      runId,
      result: {
        healthy: true,
        pendingTransition,
        provenanceFiles: provenance.fileCount,
        stateVersion: state.stateVersion,
        trajectoryLength: trajectory.length,
        telemetryBacklog: trajectory.length - cursor.trajectoryOffset,
      },
    });
  } finally {
    await app.close();
  }
}

async function browserDoctor(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const app = await bootBootstrapComposition(PRODUCT_ROOT);
  try {
    const result = await app.context.commandRouter.execute<
      { workspace: string },
      Awaited<ReturnType<BrowserMaintenance['doctor']>>
    >('browser.doctor', { workspace });
    return successEnvelope({
      command: 'browser doctor',
      result,
      nextActions:
        result.status === 'ready'
          ? []
          : [`${result.installCommand.executable} ${result.installCommand.args.join(' ')}`],
    });
  } finally {
    await app.close();
  }
}

async function browserInstall(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const app = await bootBootstrapComposition(PRODUCT_ROOT);
  try {
    const result = await app.context.commandRouter.execute('browser.install', { workspace });
    return successEnvelope({ command: 'browser install', result });
  } finally {
    await app.close();
  }
}

async function runnerStart(parsed: ParsedArguments, asJson: boolean): Promise<number> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const runner = await startRunnerApplication(PRODUCT_ROOT, workspace);
  const envelope = successEnvelope({
    command: 'runner start',
    result: {
      status: 'ready',
      origin: runner.origin,
      compositionDigest: runner.compositionDigest,
    },
  });
  process.stdout.write(`${asJson ? JSON.stringify(envelope) : renderHuman(envelope)}\n`);

  let stop!: () => void;
  const stopped = new Promise<void>((resolve) => {
    stop = resolve;
  });
  const onSignal = () => stop();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    await stopped;
    return 0;
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    await runner.close();
  }
}

async function dispatch(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const command = parsed.command.join(' ');
  if (command === 'project detect') return projectDetect(parsed);
  if (command === 'project prepare') return projectPrepare(parsed);
  if (command === 'project review') return projectReview(parsed);
  if (command === 'skill list') return skillList(parsed);
  if (command === 'skill get') return skillGet(parsed);
  if (command === 'skill project') return skillProject(parsed);
  if (command === 'spec inspect') return specificationInspect(parsed);
  if (command === 'spec validate') return specificationValidate(parsed);
  if (command === 'spec approval prepare') return specificationApprovalPrepare(parsed);
  if (command === 'spec approval status') return specificationApprovalStatus(parsed);
  if (command === 'spec approval review') return specificationApprovalReview(parsed);
  if (command === 'evidence plan') return evidencePlan(parsed);
  if (command === 'evidence run') return evidenceRun(parsed);
  if (command === 'evidence status') return evidenceStatus(parsed);
  if (command === 'evidence resume') return evidenceResume(parsed);
  if (command === 'evidence inspect') return evidenceInspect(parsed);
  if (command === 'evidence clean') return evidenceClean(parsed);
  if (command === 'run start') return runStart(parsed);
  if (command === 'run status') return runStatus(parsed);
  if (command === 'run next') return runNext(parsed);
  if (command === 'run verify') return runVerify(parsed);
  if (command === 'run archive-prepare') return runArchivePrepare(parsed);
  if (command === 'run archive-publish') return runArchivePublish(parsed);
  if (command === 'run archive-refresh') return runArchiveRefresh(parsed);
  if (command === 'run archive-verify') return runArchiveVerify(parsed);
  if (command === 'run archive-complete') return runArchiveComplete(parsed);
  if (command === 'run work-claim') return runWorkClaim(parsed);
  if (command === 'run work-outcome') return runWorkOutcome(parsed);
  if (command === 'run work-validate') return runWorkValidate(parsed);
  if (command === 'run decide') return runDecide(parsed);
  if (command === 'run record') return runRecord(parsed);
  if (command === 'run resume') return runResume(parsed);
  if (command === 'change reconcile') return changeReconcile(parsed);
  if (command === 'delivery checkpoint') return deliveryCheckpoint(parsed);
  if (command === 'delivery prepare') return deliveryPrepare(parsed);
  if (command === 'delivery status') return deliveryStatus(parsed);
  if (command === 'approval review') return approvalReview(parsed);
  if (command === 'delivery publish' || command === 'delivery resume')
    return deliveryPublish(parsed);
  if (command === 'delivery refresh') return deliveryRefresh(parsed);
  if (command === 'delivery migration-plan') return deliveryMigrationPlan(parsed);
  if (command === 'event status') return eventStatus(parsed);
  if (command === 'event replay') return eventReplay(parsed);
  if (command === 'event retry') return eventRetry(parsed);
  if (command === 'post-merge reconcile') return postMergeReconcile(parsed);
  if (command === 'doctor') return doctor(parsed);
  if (command === 'browser doctor') return browserDoctor(parsed);
  if (command === 'browser install') return browserInstall(parsed);
  throw new Error(USAGE);
}

export function renderHuman(envelope: CliEnvelope<unknown>): string {
  const lines = [envelope.ok ? `Repoctopus ${envelope.command}` : `Repoctopus error`];
  if (envelope.runId) lines.push(`Run: ${envelope.runId}`);
  for (const diagnostic of envelope.diagnostics) {
    lines.push(`${diagnostic.level.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}`);
  }
  const projection = changeProjection(envelope.result);
  if (projection) lines.push(...renderChangeProjection(projection));
  else if (envelope.result) lines.push(JSON.stringify(envelope.result, null, 2));
  if (envelope.nextActions.length > 0) {
    lines.push('Next actions:', ...envelope.nextActions.map((action) => `- ${action}`));
  }
  return lines.join('\n');
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const parsed = parseArguments(argv);
  const asJson = booleanFlag(parsed, 'json');
  const command = parsed.command.join(' ') || 'help';
  try {
    if (command === 'help' || booleanFlag(parsed, 'help')) {
      process.stdout.write(`${USAGE}\n`);
      return 0;
    }
    if (command === 'runner start') return await runnerStart(parsed, asJson);
    const envelope = await dispatch(parsed);
    process.stdout.write(`${asJson ? JSON.stringify(envelope) : renderHuman(envelope)}\n`);
    return 0;
  } catch (error) {
    const envelope = failureEnvelope(command, error);
    process.stderr.write(`${asJson ? JSON.stringify(envelope) : renderHuman(envelope)}\n`);
    return 1;
  }
}

process.exitCode = await main();
