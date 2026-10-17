import { readFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import { DeliveryService } from '../../domains/delivery/service.js';
import type { DeliveryIntent, DeliveryPolicy } from '../../domains/delivery/types.js';
import { RepoctopusRuntime } from '../../domains/runtime/runtime.js';
import type { RunStatusView } from '../../domains/runtime/types.js';
import { parseWorkflowPackage } from '../../domains/workflow-contract/package.js';
import { probeProject } from '../../platform/git/probe.js';
import { GitDeliveryAdapter } from '../../platform/git/delivery.js';
import { loadDeliveryPolicy } from '../../platform/delivery/config.js';
import { FileDeliveryStore } from '../../platform/delivery/file-delivery-store.js';
import {
  EnvironmentCredentialProvider,
  GitHubMergeRequestAdapter,
} from '../../platform/github/merge-request.js';
import { FileRuntimeStore } from '../../platform/runtime/file-runtime-store.js';
import {
  deliveryTelemetryFromEnvironment,
  telemetryFromEnvironment,
} from '../../platform/telemetry/opentelemetry/exporter.js';
import { checkProvenance } from '../../platform/provenance/check.js';
import { execute } from '../../platform/process/execute.js';
import { FileWorkflowSource } from '../../platform/workflow/file-source.js';
import { booleanFlag, parseArguments, stringFlag, type ParsedArguments } from './arguments.js';
import { failureEnvelope, successEnvelope, type CliEnvelope } from './envelope.js';
import { reviewHumanDecision } from './human-decision.js';

const DIST_DIR = path.dirname(fileURLToPath(import.meta.url));

function defaultWorkflowPath(): string {
  return path.resolve(DIST_DIR, '..', 'workflows', 'foundation.yaml');
}

function nextActions(status: RunStatusView): string[] {
  if (status.state.status === 'running') return ['repoctopus run next --run <run-id>'];
  if (status.state.status === 'waiting') {
    return [
      'repoctopus run record --run <run-id> --action <action-id> --status succeeded --summary <text>',
    ];
  }
  return [];
}

function runtimeFor(workspace: string): RepoctopusRuntime {
  return new RepoctopusRuntime(
    new FileRuntimeStore(workspace),
    telemetryFromEnvironment(process.env),
    undefined,
    undefined,
    new FileWorkflowSource(),
  );
}

function deliveryServiceFor(workspace: string, policy?: DeliveryPolicy): DeliveryService {
  return new DeliveryService(
    new FileDeliveryStore(workspace),
    new GitDeliveryAdapter(),
    new GitHubMergeRequestAdapter(
      new EnvironmentCredentialProvider(process.env),
      policy?.publication.githubApiBaseUrl,
    ),
    undefined,
    deliveryTelemetryFromEnvironment(process.env),
  );
}

async function deliveryInputs(parsed: ParsedArguments): Promise<{
  workspace: string;
  project: Awaited<ReturnType<typeof probeProject>>;
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
  const [project, intentSource, policy] = await Promise.all([
    probeProject({ root: projectRoot }),
    readFile(intentFile, 'utf8'),
    loadDeliveryPolicy(policyFile),
  ]);
  return { workspace, project, intent: parse(intentSource) as DeliveryIntent, policy };
}

async function assertCommittedReport(
  reportFile: string,
  project: Awaited<ReturnType<typeof probeProject>>,
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

function deliveryNextActions(status: Awaited<ReturnType<DeliveryService['status']>>): string[] {
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
  const result = await deliveryServiceFor(input.workspace, input.policy).checkpoint(
    input.project,
    input.intent,
    input.policy,
  );
  return successEnvelope({ command: 'delivery checkpoint', result });
}

async function deliveryPrepare(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const input = await deliveryInputs(parsed);
  const reportFile = path.resolve(stringFlag(parsed, 'report', { required: true })!);
  await assertCommittedReport(reportFile, input.project, input.intent);
  const report = await readFile(reportFile, 'utf8');
  const result = await deliveryServiceFor(input.workspace, input.policy).prepare({
    project: input.project,
    intent: input.intent,
    policy: input.policy,
    reportContents: report,
  });
  return successEnvelope({
    command: 'delivery prepare',
    result,
    nextActions: deliveryNextActions(result),
  });
}

async function deliveryStatus(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const changeId = stringFlag(parsed, 'change', { required: true })!;
  const result = await deliveryServiceFor(workspace).status(changeId);
  return successEnvelope({
    command: 'delivery status',
    result,
    nextActions: deliveryNextActions(result),
  });
}

async function approvalReview(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Human approval requires an interactive terminal or a trusted IDE Adapter');
  }
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const changeId = stringFlag(parsed, 'change', { required: true })!;
  const service = deliveryServiceFor(workspace);
  const state = await service.status(changeId);
  if (state.status !== 'awaiting_approval' || !state.decisionRequest) {
    throw new Error(`Delivery is not awaiting approval: ${changeId}`);
  }
  const selected = await reviewHumanDecision({
    request: state.decisionRequest,
    input: process.stdin,
    output: process.stdout,
  });
  const result = await service.decide(
    changeId,
    {
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'HumanDecisionResponse',
      requestId: state.decisionRequest.requestId,
      snapshotDigest: state.decisionRequest.snapshotDigest,
      decision: selected.decision,
      ...(selected.comment ? { comment: selected.comment } : {}),
    },
    {
      subject: userInfo().username,
      provider: 'interactive-cli',
      sessionId: state.decisionRequest.requestId,
    },
  );
  return successEnvelope({
    command: 'approval review',
    result,
    nextActions: deliveryNextActions(result),
  });
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
  const result = await deliveryServiceFor(input.workspace, input.policy).publish({
    project: input.project,
    intent: input.intent,
    policy: input.policy,
    reportContents: report,
  });
  return successEnvelope({
    command: 'delivery publish',
    result,
    nextActions: deliveryNextActions(result),
  });
}

async function deliveryRefresh(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const changeId = stringFlag(parsed, 'change', { required: true })!;
  const policy = await loadDeliveryPolicy(
    path.resolve(
      stringFlag(parsed, 'policy', { fallback: path.join(workspace, 'repoctopus.yaml') })!,
    ),
  );
  const result = await deliveryServiceFor(workspace, policy).refresh(changeId);
  return successEnvelope({
    command: 'delivery refresh',
    result,
    nextActions: deliveryNextActions(result),
  });
}

async function projectProbe(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const root = path.resolve(stringFlag(parsed, 'root', { required: true })!);
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const snapshot = await probeProject({ root, workspaceRoot: workspace });
  return successEnvelope({ command: 'project probe', result: snapshot });
}

async function runStart(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const projectRoot = path.resolve(
    stringFlag(parsed, 'project-root', { fallback: path.dirname(workspace) })!,
  );
  const workflowPath = path.resolve(
    stringFlag(parsed, 'workflow', { fallback: defaultWorkflowPath() })!,
  );
  const [source, projectSnapshot] = await Promise.all([
    readFile(workflowPath, 'utf8'),
    probeProject({ root: projectRoot, workspaceRoot: workspace }),
  ]);
  const requestedRunId = stringFlag(parsed, 'run');
  const result = await runtimeFor(workspace).start({
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
}

async function runStatus(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const runId = stringFlag(parsed, 'run', { required: true })!;
  const status = await runtimeFor(workspace).status(runId);
  return successEnvelope({
    command: 'run status',
    runId,
    result: status,
    nextActions: nextActions(status),
  });
}

async function runNext(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const runId = stringFlag(parsed, 'run', { required: true })!;
  const result = await runtimeFor(workspace).next(runId);
  return successEnvelope({
    command: 'run next',
    runId,
    result: result.value,
    diagnostics: result.diagnostics,
    nextActions: nextActions(result.value),
  });
}

async function runRecord(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const runId = stringFlag(parsed, 'run', { required: true })!;
  const status = stringFlag(parsed, 'status', { required: true });
  if (status !== 'succeeded' && status !== 'failed') {
    throw new Error('--status must be succeeded or failed');
  }
  const requestedEventId = stringFlag(parsed, 'event-id');
  const result = await runtimeFor(workspace).record({
    runId,
    actionId: stringFlag(parsed, 'action', { required: true })!,
    status,
    summary: stringFlag(parsed, 'summary', { required: true })!,
    ...(requestedEventId ? { eventId: requestedEventId } : {}),
  });
  return successEnvelope({
    command: 'run record',
    runId,
    result: result.value,
    diagnostics: result.diagnostics,
    nextActions: nextActions(result.value),
  });
}

async function runResume(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const runId = stringFlag(parsed, 'run', { required: true })!;
  const store = new FileRuntimeStore(workspace);
  const previous = await store.loadProjectSnapshot(runId);
  const projectRoot = path.resolve(
    stringFlag(parsed, 'project-root', { fallback: previous.root })!,
  );
  const currentProjectSnapshot = await probeProject({
    root: projectRoot,
    workspaceRoot: workspace,
  });
  const result = await new RepoctopusRuntime(
    store,
    telemetryFromEnvironment(process.env),
    undefined,
    undefined,
    new FileWorkflowSource(),
  ).resume({ runId, currentProjectSnapshot });
  return successEnvelope({
    command: 'run resume',
    runId,
    result: result.value,
    diagnostics: result.diagnostics,
    nextActions: result.value.reconciliation.changed
      ? ['inspect reconciliation and start a new run or restore the repository state']
      : nextActions(result.value),
  });
}

async function doctor(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const workspace = path.resolve(stringFlag(parsed, 'workspace', { fallback: process.cwd() })!);
  const runId = stringFlag(parsed, 'run', { required: true })!;
  const store = new FileRuntimeStore(workspace);
  const [{ state, checkpoint, trajectory, cursor, pendingTransition }, provenance] =
    await Promise.all([store.inspect(runId), checkProvenance(path.resolve(DIST_DIR, '..'))]);
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
}

async function dispatch(parsed: ParsedArguments): Promise<CliEnvelope<unknown>> {
  const command = parsed.command.join(' ');
  if (command === 'project probe') return projectProbe(parsed);
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
  throw new Error(
    'Usage: repoctopus project probe | run <start|status|next|record|resume> | delivery <checkpoint|prepare|status|publish|resume|refresh> | approval review | doctor',
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
