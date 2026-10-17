import type { DeliveryIntent, DeliveryPolicy } from './types.js';

export interface DeliveryFinding {
  code: string;
  message: string;
  path: string;
}

function nonEmptyStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0);
}

function unknownFields(
  value: unknown,
  path: string,
  allowed: readonly string[],
  findings: DeliveryFinding[],
): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    findings.push({
      code: 'unknown-policy-field',
      path,
      message: `Unknown fields: ${unknown.sort().join(', ')}`,
    });
  }
}

export function validateDeliveryPolicy(value: unknown): DeliveryFinding[] {
  const findings: DeliveryFinding[] = [];
  const policy = value as Partial<DeliveryPolicy> | null;
  if (!policy || policy.apiVersion !== 'repoctopus/v1alpha1' || policy.kind !== 'DeliveryPolicy') {
    findings.push({
      code: 'invalid-policy-header',
      path: '',
      message: 'Unsupported policy header',
    });
    return findings;
  }
  unknownFields(policy, '', ['apiVersion', 'kind', 'checkpoint', 'publication'], findings);
  unknownFields(
    policy.checkpoint,
    'checkpoint',
    ['automatic', 'protectedBranches', 'commitMessagePattern', 'quickChecks'],
    findings,
  );
  unknownFields(
    policy.publication,
    'publication',
    ['remote', 'provider', 'githubApiBaseUrl', 'mrTitleTemplate', 'mrBodyTemplate'],
    findings,
  );
  if (typeof policy.checkpoint?.automatic !== 'boolean') {
    findings.push({
      code: 'missing-automatic-mode',
      path: 'checkpoint.automatic',
      message: 'checkpoint.automatic is required',
    });
  }
  const quickChecks = policy.checkpoint?.quickChecks;
  if (!quickChecks || typeof quickChecks !== 'object' || Array.isArray(quickChecks)) {
    findings.push({
      code: 'invalid-quick-checks',
      path: 'checkpoint.quickChecks',
      message: 'quickChecks must be a repository-to-command map',
    });
  } else {
    for (const [repository, checks] of Object.entries(quickChecks)) {
      if (
        !Array.isArray(checks) ||
        checks.some(
          (check) =>
            !check ||
            typeof check.command !== 'string' ||
            !Array.isArray(check.args) ||
            check.args.some((argument) => typeof argument !== 'string'),
        )
      )
        findings.push({
          code: 'invalid-quick-check',
          path: `checkpoint.quickChecks.${repository}`,
          message: 'Each quick check requires a command and string args',
        });
      if (Array.isArray(checks)) {
        checks.forEach((check, index) =>
          unknownFields(
            check,
            `checkpoint.quickChecks.${repository}[${index}]`,
            ['command', 'args'],
            findings,
          ),
        );
      }
    }
  }
  if (!nonEmptyStrings(policy.checkpoint?.protectedBranches)) {
    findings.push({
      code: 'missing-protected-branches',
      path: 'checkpoint.protectedBranches',
      message: 'At least one protected branch is required',
    });
  }
  const pattern = policy.checkpoint?.commitMessagePattern;
  if (typeof pattern !== 'string' || pattern.length === 0) {
    findings.push({
      code: 'missing-commit-format',
      path: 'checkpoint.commitMessagePattern',
      message: 'Commit message format is required',
    });
  } else {
    try {
      new RegExp(pattern);
    } catch {
      findings.push({
        code: 'invalid-commit-format',
        path: 'checkpoint.commitMessagePattern',
        message: 'Commit message pattern is invalid',
      });
    }
  }
  if (!policy.publication?.remote)
    findings.push({
      code: 'missing-remote',
      path: 'publication.remote',
      message: 'Publication remote is required',
    });
  if (policy.publication?.provider !== 'github')
    findings.push({
      code: 'unsupported-provider',
      path: 'publication.provider',
      message: 'Only github is supported in this version',
    });
  try {
    if (
      !policy.publication?.githubApiBaseUrl ||
      new URL(policy.publication.githubApiBaseUrl).protocol !== 'https:'
    )
      throw new Error('invalid');
  } catch {
    findings.push({
      code: 'invalid-github-api-url',
      path: 'publication.githubApiBaseUrl',
      message: 'GitHub API base URL must use HTTPS',
    });
  }
  if (!policy.publication?.mrTitleTemplate)
    findings.push({
      code: 'missing-mr-title-template',
      path: 'publication.mrTitleTemplate',
      message: 'MR title template is required',
    });
  if (!policy.publication?.mrBodyTemplate)
    findings.push({
      code: 'missing-mr-body-template',
      path: 'publication.mrBodyTemplate',
      message: 'MR body template is required',
    });
  return findings;
}

export function validateDeliveryIntent(intent: DeliveryIntent): DeliveryFinding[] {
  const findings: DeliveryFinding[] = [];
  if (intent.schemaVersion !== 1)
    findings.push({
      code: 'unsupported-intent-version',
      path: 'schemaVersion',
      message: 'Only schemaVersion 1 is supported',
    });
  if (!/^[a-z0-9][a-z0-9-]{2,127}$/.test(intent.changeId))
    findings.push({
      code: 'invalid-change-id',
      path: 'changeId',
      message: 'changeId must use kebab-case',
    });
  if (intent.repositories.length === 0)
    findings.push({
      code: 'missing-repositories',
      path: 'repositories',
      message: 'At least one repository must be selected',
    });
  const seen = new Set<string>();
  for (const [index, repository] of intent.repositories.entries()) {
    const root = `repositories[${index}]`;
    if (!repository.repositoryId)
      findings.push({
        code: 'missing-repository-id',
        path: `${root}.repositoryId`,
        message: 'repositoryId is required',
      });
    if (seen.has(repository.repositoryId))
      findings.push({
        code: 'duplicate-repository',
        path: `${root}.repositoryId`,
        message: 'Repository is selected more than once',
      });
    seen.add(repository.repositoryId);
    if (!repository.sourceBranch)
      findings.push({
        code: 'missing-source-branch',
        path: `${root}.sourceBranch`,
        message: 'sourceBranch is required',
      });
    if (!repository.targetBranch)
      findings.push({
        code: 'missing-target-branch',
        path: `${root}.targetBranch`,
        message: 'targetBranch is required',
      });
    if (repository.sourceBranch && repository.sourceBranch === repository.targetBranch)
      findings.push({
        code: 'source-target-equal',
        path: root,
        message: 'sourceBranch and targetBranch must differ',
      });
    if (!repository.commitMessage)
      findings.push({
        code: 'missing-commit-message',
        path: `${root}.commitMessage`,
        message: 'commitMessage is required',
      });
    if (repository.actions.length === 0)
      findings.push({
        code: 'missing-actions',
        path: `${root}.actions`,
        message: 'At least one action is required',
      });
    if (repository.actions.some((action) => action !== 'push' && action !== 'merge_request'))
      findings.push({
        code: 'unsupported-action',
        path: `${root}.actions`,
        message: 'Only push and merge_request actions are allowed',
      });
  }
  return findings;
}
