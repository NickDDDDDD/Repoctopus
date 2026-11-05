import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const workflowPath = path.join(repositoryRoot, '.github', 'workflows', 'ci.yml');
const packageJsonPath = path.join(repositoryRoot, 'package.json');

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function workflowProblems(workflow: unknown): string[] {
  const root = record(workflow);
  const triggers = record(root.on);
  const permissions = record(root.permissions);
  const concurrency = record(root.concurrency);
  const verify = record(record(root.jobs).verify);
  const steps = Array.isArray(verify.steps) ? verify.steps.map(record) : [];
  const setupNode = steps.find((step) => step.uses === 'actions/setup-node@v4');
  const checkout = steps.find((step) => step.uses === 'actions/checkout@v4');
  const commands = steps
    .map((step) => step.run)
    .filter((command): command is string => typeof command === 'string')
    .map((command) => command.trim());
  const problems: string[] = [];

  if (root.name !== 'Continuous integration') problems.push('workflow-name');
  if (!Object.hasOwn(triggers, 'pull_request')) problems.push('pull-request-trigger');
  if (!Object.hasOwn(triggers, 'workflow_dispatch')) problems.push('manual-trigger');
  const pushBranches = record(triggers.push).branches;
  if (!Array.isArray(pushBranches) || !pushBranches.includes('main')) {
    problems.push('main-push-trigger');
  }
  if (Object.keys(permissions).length !== 1 || permissions.contents !== 'read') {
    problems.push('read-only-permissions');
  }
  if (Object.hasOwn(verify, 'permissions')) problems.push('job-permission-override');
  if (
    concurrency.group !== '${{ github.workflow }}-${{ github.ref }}' ||
    concurrency['cancel-in-progress'] !== true
  ) {
    problems.push('concurrency-cancellation');
  }
  if (verify['runs-on'] !== 'ubuntu-latest') problems.push('ubuntu-runner');
  if (!checkout) problems.push('checkout-step');
  const checkoutOptions = record(checkout?.with);
  if (checkoutOptions['fetch-depth'] !== 0) problems.push('full-history-checkout');
  const nodeOptions = record(setupNode?.with);
  if (nodeOptions['node-version'] !== 24 || nodeOptions.cache !== 'npm') {
    problems.push('node-toolchain');
  }
  if (commands.join('\n') !== 'npm ci\nnpm run verify') {
    problems.push('canonical-verify-commands');
  }

  return problems;
}

function validWorkflowFixture(): JsonRecord {
  return {
    name: 'Continuous integration',
    on: {
      pull_request: {},
      push: { branches: ['main'] },
      workflow_dispatch: {},
    },
    permissions: { contents: 'read' },
    concurrency: {
      group: '${{ github.workflow }}-${{ github.ref }}',
      'cancel-in-progress': true,
    },
    jobs: {
      verify: {
        'runs-on': 'ubuntu-latest',
        steps: [
          { uses: 'actions/checkout@v4', with: { 'fetch-depth': 0 } },
          {
            uses: 'actions/setup-node@v4',
            with: { 'node-version': 24, cache: 'npm' },
          },
          { run: 'npm ci' },
          { run: 'npm run verify' },
        ],
      },
    },
  };
}

describe('repository continuous integration contract', () => {
  it('runs the canonical repository verification in a clean, read-only job', async () => {
    const source = await readFile(workflowPath, 'utf8').catch(() => null);
    const workflow: unknown = source === null ? {} : (parse(source) as unknown);

    expect(workflowProblems(workflow)).toEqual([]);
  });

  it('rejects permission, default-branch, and duplicated-command regressions', () => {
    const writable = validWorkflowFixture();
    record(writable.permissions).actions = 'write';
    expect(workflowProblems(writable)).toContain('read-only-permissions');

    const jobPermissionOverride = validWorkflowFixture();
    record(record(jobPermissionOverride.jobs).verify).permissions = { contents: 'write' };
    expect(workflowProblems(jobPermissionOverride)).toContain('job-permission-override');

    const wrongBranch = validWorkflowFixture();
    record(record(wrongBranch.on).push).branches = ['develop'];
    expect(workflowProblems(wrongBranch)).toContain('main-push-trigger');

    const duplicatedChecks = validWorkflowFixture();
    const verify = record(record(duplicatedChecks.jobs).verify);
    (verify.steps as JsonRecord[]).splice(3, 0, { run: 'npm run lint' });
    expect(workflowProblems(duplicatedChecks)).toContain('canonical-verify-commands');

    const shallowCheckout = validWorkflowFixture();
    const shallowVerify = record(record(shallowCheckout.jobs).verify);
    const shallowStep = (shallowVerify.steps as JsonRecord[])[0]!;
    shallowStep.with = { 'fetch-depth': 1 };
    expect(workflowProblems(shallowCheckout)).toContain('full-history-checkout');
  });

  it('builds current sources before the standalone package acceptance command', async () => {
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as unknown;
    const scripts = record(record(packageJson).scripts);

    expect(scripts['pretest:package-e2e']).toBe('npm run build');
    expect(scripts['test:package-e2e']).toBe('vitest run test/e2e/package.e2e.test.ts');
  });
});
