import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Candidate = { size: number; digest: string };
type WorkflowPolicy = {
  assertWorkflowAcceptance(this: void, evidence: unknown, candidate: Candidate): void;
};

async function policy(): Promise<WorkflowPolicy> {
  return (await import(
    new URL('../scripts/release-policy.mjs', import.meta.url).href
  )) as WorkflowPolicy;
}

const candidate = { size: 123, digest: 'sha256:' + 'a'.repeat(64) };
const passed = {
  kind: 'WindowsMultirepoPackageE2E',
  status: 'passed',
  candidate,
  runId: 'fixture-run',
  finalStatus: 'completed',
  checks: [
    { id: 'init-to-archive', status: 'passed' },
    { id: 'build-cold-recovery', status: 'passed' },
    { id: 'publication-response-loss', status: 'passed' },
    { id: 'terminal-recovery', status: 'passed' },
  ],
};

describe('Windows multirepository release acceptance', () => {
  it('keeps default diagnostics outside the packaged source tree', async () => {
    const environment = { ...process.env };
    delete environment.REPOCTOPUS_WORKFLOW_E2E_EVIDENCE;
    const child = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('../scripts/windows-multirepo-package-e2e.mjs', import.meta.url))],
      { env: environment, encoding: 'utf8', windowsHide: true, timeout: 10_000 },
    );
    expect(child.status).toBe(1);
    const evidence = /^Evidence: (.+)$/mu.exec(child.stdout)?.[1]?.trim();
    expect(evidence).toBeDefined();
    const directory = path.dirname(evidence!);
    expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(directory)).toMatch(/^repoctopus-workflow-evidence-\d+$/u);
    try {
      expect(JSON.parse(await readFile(evidence!, 'utf8'))).toMatchObject({ status: 'failed' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('requires an explicit tarball and persists input failures', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'rp-input-'));
    try {
      const evidence = path.join(directory, 'receipt.json');
      const child = spawnSync(
        process.execPath,
        [fileURLToPath(new URL('../scripts/windows-multirepo-package-e2e.mjs', import.meta.url))],
        {
          env: { ...process.env, REPOCTOPUS_WORKFLOW_E2E_EVIDENCE: evidence },
          encoding: 'utf8',
          windowsHide: true,
          timeout: 10_000,
        },
      );
      expect(child.status).toBe(1);
      expect(child.stderr).toContain('Usage:');
      expect(JSON.parse(await readFile(evidence, 'utf8'))).toMatchObject({
        kind: 'WindowsMultirepoPackageE2E',
        status: 'failed',
        failure: { stage: 'candidate-input' },
        checks: [],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('accepts the exact CLI candidate only after all recovery checks pass', async () => {
    const { assertWorkflowAcceptance } = await policy();
    expect(() => assertWorkflowAcceptance(passed, candidate)).not.toThrow();
  });

  it.each([
    undefined,
    {},
    { ...passed, kind: 'OtherAcceptance' },
    { ...passed, status: 'failed' },
    { ...passed, finalStatus: 'running' },
    { ...passed, runId: '' },
    { ...passed, candidate: { ...candidate, digest: 'sha256:' + 'b'.repeat(64) } },
    { ...passed, candidate: { ...candidate, size: 124 } },
    { ...passed, checks: passed.checks.slice(0, -1) },
    { ...passed, checks: [...passed.checks, passed.checks[0]] },
    { ...passed, checks: passed.checks.map((check) => ({ ...check, status: 'failed' })) },
  ])('rejects incomplete, failed or mismatched evidence %#', async (evidence) => {
    const { assertWorkflowAcceptance } = await policy();
    expect(() => assertWorkflowAcceptance(evidence, candidate)).toThrow(/workflow acceptance/iu);
  });
});
