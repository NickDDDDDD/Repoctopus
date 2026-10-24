import path from 'node:path';

import type { EvidenceExecutionPlan, PlannedEvidenceNode } from '../feedback/profile.js';
import { redactEvidenceText, type RedactionOptions } from './redaction.js';
import type { EvidenceBundle, EvidenceReceipt } from './types.js';

export const MAX_VERIFICATION_REPORT_BYTES = 64 * 1024;
const MAX_TEXT_CHARACTERS = 512;
const MAX_ARGUMENTS = 64;

export interface VerificationReportNode {
  nodeId: string;
  type: PlannedEvidenceNode['type'];
  required: boolean;
  command?: { executable: string; args: readonly string[]; cwd: string };
  result: {
    status: string;
    trust?: string;
    freshness?: string;
    receiptId?: string;
    exitCode?: number;
    startedAt?: string;
    completedAt?: string;
  };
  findings: readonly { code: string; severity: string; summary: string }[];
  artifactRefs: readonly {
    sha256: string;
    size: number;
    mediaType: string;
    artifactType: string;
    redacted: boolean;
  }[];
}

export interface VerificationReport {
  schemaVersion: 1;
  kind: 'VerificationReport';
  attemptId: string;
  profileId: string;
  compositionDigest: string;
  inputFingerprint: string;
  outcome: EvidenceBundle['outcome'];
  createdAt: string;
  nodes: readonly VerificationReportNode[];
  receiptIds: readonly string[];
  evidenceArtifactDigests: readonly string[];
  truncated: boolean;
  limits: { maxBytes: number; embeddedOutput: false };
}

function bounded(value: string): string {
  return value.length <= MAX_TEXT_CHARACTERS
    ? value
    : `${value.slice(0, MAX_TEXT_CHARACTERS - 15)}…[truncated]`;
}

function safeText(value: string, options: RedactionOptions): string {
  return bounded(redactEvidenceText(value, options).contents);
}

export function createVerificationReport(input: {
  plan: EvidenceExecutionPlan;
  receipts: readonly EvidenceReceipt[];
  bundle: EvidenceBundle;
  redaction?: RedactionOptions;
}): { report: VerificationReport; contents: string } {
  const receipts = new Map(input.receipts.map((receipt) => [receipt.nodeId, receipt]));
  const checks = new Map(input.bundle.checks.map((check) => [check.nodeId, check]));
  const absolutePaths = input.plan.nodes.map((node) => node.repositoryPath);
  const redaction = {
    ...input.redaction,
    absolutePaths: [...absolutePaths, ...(input.redaction?.absolutePaths ?? [])],
  };
  const nodes = input.plan.nodes.map((node): VerificationReportNode => {
    const receipt = receipts.get(node.id);
    const check = checks.get(node.id);
    return {
      nodeId: node.id,
      type: node.type,
      required: node.required,
      ...(node.type === 'command'
        ? {
            command: {
              executable: safeText(path.basename(node.executable), redaction),
              args: node.args
                .slice(0, MAX_ARGUMENTS)
                .map((argument) => safeText(argument, redaction)),
              cwd: safeText(node.cwd ?? '.', redaction),
            },
          }
        : {}),
      result: {
        status: check?.status ?? 'incomplete',
        ...(check?.trust ? { trust: check.trust } : {}),
        ...(check?.freshness ? { freshness: check.freshness } : {}),
        ...(receipt
          ? {
              receiptId: receipt.receiptId,
              ...(receipt.exitCode !== undefined ? { exitCode: receipt.exitCode } : {}),
              startedAt: receipt.startedAt,
              completedAt: receipt.completedAt,
            }
          : {}),
      },
      findings: (receipt?.findings ?? [])
        .slice(0, 128)
        .map((finding) => ({
          code: finding.code,
          severity: finding.severity,
          summary: safeText(finding.summary, redaction),
        })),
      artifactRefs: (receipt?.artifacts ?? []).map((artifact) => ({ ...artifact })),
    };
  });
  const base = {
    schemaVersion: 1 as const,
    kind: 'VerificationReport' as const,
    attemptId: input.bundle.attemptId,
    profileId: input.bundle.profileId,
    compositionDigest: input.bundle.compositionDigest,
    inputFingerprint: input.bundle.inputFingerprint,
    outcome: input.bundle.outcome,
    createdAt: input.bundle.createdAt,
    receiptIds: [...input.bundle.receiptIds],
    evidenceArtifactDigests: [...input.bundle.artifactDigests],
    limits: { maxBytes: MAX_VERIFICATION_REPORT_BYTES, embeddedOutput: false as const },
  };
  let included = [...nodes];
  let report: VerificationReport = { ...base, nodes: included, truncated: false };
  let contents = JSON.stringify(report);
  while (Buffer.byteLength(contents, 'utf8') > MAX_VERIFICATION_REPORT_BYTES && included.length) {
    included = included.slice(0, -1);
    report = { ...base, nodes: included, truncated: true };
    contents = JSON.stringify(report);
  }
  if (Buffer.byteLength(contents, 'utf8') > MAX_VERIFICATION_REPORT_BYTES) {
    throw new Error('Verification report identity exceeds the configured size limit');
  }
  return { report, contents };
}
