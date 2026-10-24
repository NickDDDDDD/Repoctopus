import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { EvidenceService } from '../domains/evidence/service.js';
import { compileEvidenceProfile } from '../domains/feedback/profile.js';
import type { EffectiveProjectConfig } from '../domains/project-configuration/types.js';
import { FileArtifactStore } from '../platform/evidence/file-artifact-store.js';
import { FileEvidenceStore } from '../platform/evidence/file-evidence-store.js';
import { LocalCommandAdapter } from '../platform/feedback/command-adapter.js';
import { MAX_VERIFICATION_REPORT_BYTES } from '../domains/evidence/verification-report.js';
import {
  removeTemporaryDirectory,
  temporaryDirectory,
  TEST_COMPOSITION_DIGEST,
} from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

function config(
  workspace: string,
  nodes: EffectiveProjectConfig['shared']['profiles'][number]['nodes'],
): EffectiveProjectConfig {
  return {
    shared: {
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'RepoctopusWorkspace',
      workspace: { id: 'sample', repositoryId: 'workspace' },
      repositories: [{ id: 'workspace', path: '.' }],
      profiles: [{ id: 'verify', nodes }],
    },
    local: null,
    repositories: [{ id: 'workspace', path: '.', resolvedPath: workspace }],
    sharedDigest: 'shared',
    localDigest: null,
    effectiveDigest: 'effective',
  };
}

function command(
  id: string,
  script: string,
  options: { dependsOn?: string[]; required?: boolean } = {},
): Extract<
  EffectiveProjectConfig['shared']['profiles'][number]['nodes'][number],
  { type: 'command' }
> {
  return {
    id,
    type: 'command',
    repository: 'workspace',
    dependsOn: options.dependsOn ?? [],
    required: options.required ?? true,
    executable: process.execPath,
    args: ['-e', script],
    timeoutMs: 5000,
    cache: false,
  };
}

describe('evidence command vertical slice', () => {
  it('persists receipts and artifacts while blocking only dependent nodes', async () => {
    const workspace = await temporaryDirectory('repoctopus-evidence-');
    cleanup.push(workspace);
    const plan = compileEvidenceProfile(
      config(workspace, [
        command('build', "process.stdout.write('built'); process.exit(2)"),
        command('browser', "process.stdout.write('should not run')", { dependsOn: ['build'] }),
        command('backend', "process.stderr.write('healthy')"),
      ]),
      'verify',
    );
    const store = new FileEvidenceStore(workspace);
    const result = await new EvidenceService(
      new FileArtifactStore(workspace),
      store,
      new LocalCommandAdapter(),
    ).run(plan, 'fingerprint-1', { compositionDigest: TEST_COMPOSITION_DIGEST });

    expect(result.bundle.outcome).toBe('failed');
    expect(result.bundle.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeId: 'build', status: 'failed' }),
        expect.objectContaining({ nodeId: 'browser', status: 'blocked', blockedBy: ['build'] }),
        expect.objectContaining({ nodeId: 'backend', status: 'passed', trust: 'verified' }),
      ]),
    );
    expect(result.receipts.map((receipt) => receipt.nodeId).sort()).toEqual(['backend', 'build']);
    expect(result.bundle.artifactDigests).toHaveLength(3);
    expect(result.bundle.verificationReport).toMatchObject({
      artifactType: 'verification-report',
      redacted: true,
    });
    expect((await store.loadBundle(result.bundle.bundleId)).outcome).toBe('failed');
  });

  it('writes a bounded redacted report that references commands, results, and evidence identities', async () => {
    const workspace = await temporaryDirectory('repoctopus-evidence-report-');
    cleanup.push(workspace);
    const plan = compileEvidenceProfile(
      config(workspace, [
        command(
          'report',
          "process.stdout.write('token=report-secret ' + 'x'.repeat(10000)); process.exit(1)",
        ),
      ]),
      'verify',
    );
    const artifacts = new FileArtifactStore(workspace);
    const result = await new EvidenceService(
      artifacts,
      new FileEvidenceStore(workspace),
      new LocalCommandAdapter(),
    ).run(plan, 'fingerprint-report', {
      compositionDigest: TEST_COMPOSITION_DIGEST,
      maxOutputBytes: 256,
      sensitiveValues: ['report-secret'],
    });

    const reference = result.bundle.verificationReport!;
    const contents = Buffer.from(await artifacts.read(reference)).toString('utf8');
    const report = JSON.parse(contents) as Record<string, unknown>;
    expect(reference.size).toBeLessThanOrEqual(MAX_VERIFICATION_REPORT_BYTES);
    expect(contents).not.toContain('report-secret');
    expect(contents).not.toContain('x'.repeat(1000));
    expect(report).toMatchObject({
      kind: 'VerificationReport',
      attemptId: result.attempt.attemptId,
      outcome: 'failed',
      limits: { maxBytes: MAX_VERIFICATION_REPORT_BYTES, embeddedOutput: false },
      nodes: [
        {
          nodeId: 'report',
          command: { executable: path.basename(process.execPath) },
          result: { status: 'failed', receiptId: result.receipts[0]!.receiptId },
        },
      ],
    });
    expect(result.bundle.artifactDigests).toContain(reference.sha256);
  });

  it('keeps failed, timed-out, cancelled, retried, and superseded Attempts distinct', async () => {
    const workspace = await temporaryDirectory('repoctopus-evidence-report-lifecycle-');
    cleanup.push(workspace);
    const artifacts = new FileArtifactStore(workspace);
    const store = new FileEvidenceStore(workspace);
    const service = new EvidenceService(artifacts, store, new LocalCommandAdapter());
    const timedOutPlan = compileEvidenceProfile(
      config(workspace, [
        { ...command('check', 'setInterval(() => {}, 1000)'), timeoutMs: 20 },
      ]),
      'verify',
    );
    const timedOut = await service.run(timedOutPlan, 'fingerprint-timeout', {
      attemptId: 'attempt-timeout',
      compositionDigest: TEST_COMPOSITION_DIGEST,
    });
    expect(timedOut.bundle).toMatchObject({
      outcome: 'failed',
      verificationReport: { artifactType: 'verification-report' },
    });
    expect(timedOut.receipts[0]?.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'command-timeout' })]),
    );

    const retryPlan = compileEvidenceProfile(
      config(workspace, [command('check', 'process.exit(0)')]),
      'verify',
    );
    const retry = await service.run(retryPlan, 'fingerprint-retry', {
      attemptId: 'attempt-retry',
      compositionDigest: TEST_COMPOSITION_DIGEST,
    });
    expect(retry.bundle.outcome).toBe('passed');
    expect(retry.bundle.bundleId).not.toBe(timedOut.bundle.bundleId);
    expect((await store.loadAttempt('attempt-timeout')).status).toBe('completed');

    const superseded = await service.run(retryPlan, 'fingerprint-before', {
      attemptId: 'attempt-superseded',
      compositionDigest: TEST_COMPOSITION_DIGEST,
      captureEndingFingerprint: () => Promise.resolve('fingerprint-after'),
    });
    expect(superseded.attempt.status).toBe('superseded');
    expect(superseded.bundle.outcome).toBe('incomplete');

    await expect(
      service.run(retryPlan, 'fingerprint-cancelled', {
        attemptId: 'attempt-cancelled',
        compositionDigest: TEST_COMPOSITION_DIGEST,
        signal: AbortSignal.abort(new Error('cancelled')),
      }),
    ).rejects.toThrow(/cancelled/u);
    await expect(store.loadAttempt('attempt-cancelled')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('returns passed_with_warnings for an optional command failure', async () => {
    const workspace = await temporaryDirectory('repoctopus-evidence-warning-');
    cleanup.push(workspace);
    const plan = compileEvidenceProfile(
      config(workspace, [
        command('required', 'process.exit(0)'),
        command('optional', 'process.exit(1)', { required: false }),
      ]),
      'verify',
    );
    const result = await new EvidenceService(
      new FileArtifactStore(workspace),
      new FileEvidenceStore(workspace),
      new LocalCommandAdapter(),
    ).run(plan, 'fingerprint-2', { compositionDigest: TEST_COMPOSITION_DIGEST });
    expect(result.bundle.outcome).toBe('passed_with_warnings');
  });

  it('uses the active Specification Provider as verified Evidence and blocks an invalid change', async () => {
    const workspace = await temporaryDirectory('repoctopus-evidence-specification-');
    cleanup.push(workspace);
    const plan = compileEvidenceProfile(
      config(workspace, [
        {
          id: 'specification',
          type: 'specification',
          repository: 'workspace',
          dependsOn: [],
          required: true,
          changeId: 'invalid-change',
          strict: true,
        },
        command('implementation', 'process.exit(0)', { dependsOn: ['specification'] }),
      ]),
      'verify',
    );
    const result = await new EvidenceService(
      new FileArtifactStore(workspace),
      new FileEvidenceStore(workspace),
      new LocalCommandAdapter(),
      undefined,
      undefined,
      {
        specification: {
          validate: () =>
            Promise.resolve({
              apiVersion: 'repoctopus.specification/v1alpha1',
              kind: 'SpecificationValidation',
              changeId: 'invalid-change',
              provider: {
                id: 'openspec',
                version: '1.14.3',
                protocolVersion: 'repoctopus.specification/v1alpha1',
              },
              strict: true,
              valid: false,
              validationDigest: `sha256:${'a'.repeat(64)}`,
              diagnostics: [
                {
                  code: 'delta.invalid',
                  severity: 'error',
                  message: 'Delta spec is invalid',
                },
              ],
            }),
        },
      },
    ).run(plan, 'fingerprint-specification', {
      compositionDigest: TEST_COMPOSITION_DIGEST,
    });

    expect(result.bundle.outcome).toBe('failed');
    expect(result.bundle.checks).toEqual([
      expect.objectContaining({ nodeId: 'specification', status: 'failed', trust: 'verified' }),
      expect.objectContaining({
        nodeId: 'implementation',
        status: 'blocked',
        blockedBy: ['specification'],
      }),
    ]);
    expect(result.receipts[0]).toMatchObject({
      adapter: 'specification:openspec@1.14.3',
      findings: [{ code: 'delta.invalid', summary: 'Delta spec is invalid' }],
    });
  });
});
