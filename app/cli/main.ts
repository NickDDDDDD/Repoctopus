import { readFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import type {
  DeliveryIntent,
  DeliveryPolicy,
  DeliveryState,
} from '../../domains/delivery/types.js';
import type { ProjectSnapshot } from '../../domains/project/types.js';
import type {
  ResumeView,
  RunStatusView,
  RunStoreInspection,
  RuntimeResult,
} from '../../domains/runtime/types.js';
import { parseWorkflowPackage } from '../../domains/workflow-contract/package.js';
import { loadDeliveryPolicy } from '../../platform/delivery/config.js';
import { execute } from '../../platform/process/execute.js';
import type { ProvenanceCheck } from '../../platform/provenance/check.js';
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

const DIST_DIR = path.dirname(fileURLToPath(import.meta.url));
const PRODUCT_ROOT =
  path.basename(DIST_DIR) === 'dist'
    ? path.resolve(DIST_DIR, '..')
    : path.resolve(DIST_DIR, '..', '..');

function defaultWorkflowPath(): string {
  return path.resolve(DIST_DIR, '..', 'workflows', 'foundation.yaml');
}

function nextActions(status: RunStatusView): string[] {
  if (status.state.status === 'running') return ['repoctopus run next --run <run-id>'];
  if (status.state.status === 'waiting') {
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
  projectRoot: string;
  intent: DeliveryIntent;
  policy: DeliveryPolicy;
}> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const projectRoot = path.resolve(
    stringFlag(parsed, 'project-root', { fallback: path.dirname(workspace) })!,
  );
  const intentFile = path.resolve(stringFlag(parsed, 'intent', { required: true })!);
  const policyFile = path.resolve(
    stringFlag(parsed, 'policy', { fallback: path.join(workspace, 'repoctopus.yaml') })!,
  );
  const [intentSource, policy] = await Promise.all([
    readFile(intentFile, 'utf8'),
    loadDeliveryPolicy(policyFile),
  ]);
  return { workspace, projectRoot, intent: parse(intentSource) as DeliveryIntent, policy };
}

async function assertCommittedReport(
  reportFile: string,
  project: ProjectSnapshot,
  intent: DeliveryIntent,
): Promise<void> {
  const selected = new Set(intent.repositories.map((item) => item.repositoryId));
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
  input: { workspace: string; projectRoot: string },
): Promise<ProjectSnapshot> {
  return app.context.commandRouter.execute('project.probe', {
    root: input.projectRoot,
    workspaceRoot: input.workspace,
  });
}

function deliveryNextActions(status: DeliveryState): string[] {
  if (status.status === 'awaiting_approval') {
    return [`repoctopus approval review --change ${status.changeId}`];
  }
  if (status.status === 'approved' || status.status === 'partially_published') {
    return [
      `repoctopus delivery publish --change ${status.changeId} --intent <file> --policy <file> --report <file>`,
    ];
  }
  if (status.status === 'in_review')
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
    const result = await app.context.commandRouter.execute<unknown, DeliveryState>(
      'delivery.prepare',
      {
        project,
        intent: input.intent,
        policy: input.policy,
        reportContents: report,
        evidenceBundleIds: evidenceBundleIds(parsed),
      },
    );
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
    const result = await app.context.commandRouter.execute<unknown, DeliveryState>(
      'delivery.status',
      { changeId },
    );
    return successEnvelope({
      command: 'delivery status',
      result,
      nextActions: deliveryNextActions(result),
    });
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
    const state = await app.context.commandRouter.execute<unknown, DeliveryState>(
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
    const result = await app.context.commandRouter.execute<unknown, DeliveryState>(
      'delivery.decide',
      {
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
      },
    );
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
    const result = await app.context.commandRouter.execute<unknown, DeliveryState>(
      'delivery.publish',
      {
        project: await deliveryProject(app, input),
        intent: input.intent,
        policy: input.policy,
        reportContents: report,
        evidenceBundleIds: evidenceBundleIds(parsed),
      },
    );
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
    const result = await app.context.commandRouter.execute<unknown, DeliveryState>(
      'delivery.refresh',
      { changeId, policy },
    );
    return successEnvelope({
      command: 'delivery refresh',
      result,
      nextActions: deliveryNextActions(result),
    });
  } finally {
    await app.close();
  }
}

async function projectProbe(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const root = path.resolve(stringFlag(parsed, 'root', { required: true })!);
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const app = await bootBootstrapComposition(PRODUCT_ROOT);
  try {
    const snapshot = await app.context.commandRouter.execute('project.probe', {
      root,
      workspaceRoot: workspace,
    });
    return successEnvelope({ command: 'project probe', result: snapshot });
  } finally {
    await app.close();
  }
}

async function projectDetect(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const scopeRoot = path.resolve(stringFlag(parsed, 'root', { required: true })!);
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const app = await bootBootstrapComposition(PRODUCT_ROOT);
  try {
    const result = await app.context.commandRouter.execute('project.detect', {
      workspace,
      scopeRoot,
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
  const projectRoot = path.resolve(
    stringFlag(parsed, 'project-root', { fallback: path.dirname(workspace) })!,
  );
  const workflowPath = path.resolve(
    stringFlag(parsed, 'workflow', { fallback: defaultWorkflowPath() })!,
  );
  const app = await bootProjectComposition(PRODUCT_ROOT, workspace);
  try {
    const [source, projectSnapshot] = await Promise.all([
      readFile(workflowPath, 'utf8'),
      app.context.commandRouter.execute<{ root: string; workspaceRoot: string }, ProjectSnapshot>(
        'project.probe',
        { root: projectRoot, workspaceRoot: workspace },
      ),
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
      diagnostics: result.diagnostics,
      nextActions: nextActions(result.value),
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
    const previous = await app.context.runStore.loadProjectSnapshot(runId);
    const projectRoot = path.resolve(
      stringFlag(parsed, 'project-root', { fallback: previous.root })!,
    );
    const currentProjectSnapshot = await app.context.commandRouter.execute<
      { root: string; workspaceRoot: string },
      ProjectSnapshot
    >('project.probe', { root: projectRoot, workspaceRoot: workspace });
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

async function dispatch(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const command = parsed.command.join(' ');
  if (command === 'project probe') return projectProbe(parsed);
  if (command === 'project detect') return projectDetect(parsed);
  if (command === 'project prepare') return projectPrepare(parsed);
  if (command === 'project review') return projectReview(parsed);
  if (command === 'evidence plan') return evidencePlan(parsed);
  if (command === 'evidence run') return evidenceRun(parsed);
  if (command === 'evidence status') return evidenceStatus(parsed);
  if (command === 'evidence resume') return evidenceResume(parsed);
  if (command === 'evidence inspect') return evidenceInspect(parsed);
  if (command === 'evidence clean') return evidenceClean(parsed);
  if (command === 'run start') return runStart(parsed);
  if (command === 'run status') return runStatus(parsed);
  if (command === 'run next') return runNext(parsed);
  if (command === 'run record') return runRecord(parsed);
  if (command === 'run resume') return runResume(parsed);
  if (command === 'delivery checkpoint') return deliveryCheckpoint(parsed);
  if (command === 'delivery prepare') return deliveryPrepare(parsed);
  if (command === 'delivery status') return deliveryStatus(parsed);
  if (command === 'approval review') return approvalReview(parsed);
  if (command === 'delivery publish' || command === 'delivery resume')
    return deliveryPublish(parsed);
  if (command === 'delivery refresh') return deliveryRefresh(parsed);
  if (command === 'doctor') return doctor(parsed);
  if (command === 'browser doctor') return browserDoctor(parsed);
  if (command === 'browser install') return browserInstall(parsed);
  throw new Error(
    'Usage: repoctopus project <probe|detect|prepare|review> | evidence <plan|run|status|resume|inspect|clean> | run <start|status|next|record|resume> | delivery <checkpoint|prepare|status|publish|resume|refresh> | approval review | browser <doctor|install> | doctor',
  );
}

function renderHuman(envelope: CliEnvelope<unknown>): string {
  const lines = [envelope.ok ? `Repoctopus ${envelope.command}` : `Repoctopus error`];
  if (envelope.runId) lines.push(`Run: ${envelope.runId}`);
  for (const diagnostic of envelope.diagnostics) {
    lines.push(`${diagnostic.level.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}`);
  }
  if (envelope.result) lines.push(JSON.stringify(envelope.result, null, 2));
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
