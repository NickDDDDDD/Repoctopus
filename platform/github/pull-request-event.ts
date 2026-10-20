import type { MergeRequestReference } from '../../domains/delivery/types.js';
import type { PlatformDeliveryEnvelope } from '../../domains/platform-events/types.js';
import { normalizeRemoteIdentity } from '../git/remote-identity.js';

export class GitHubPullRequestEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubPullRequestEventError';
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GitHubPullRequestEventError(`GitHub pull request event requires ${field}`);
  }
  return value as Record<string, unknown>;
}

export function githubPullRequestReference(
  envelope: PlatformDeliveryEnvelope,
): MergeRequestReference {
  if (envelope.provider !== 'github' || envelope.eventType !== 'pull_request') {
    throw new GitHubPullRequestEventError('Envelope is not a GitHub pull request event');
  }
  const repository = record(envelope.payload.repository, 'repository');
  const pullRequest = record(envelope.payload.pull_request, 'pull_request');
  const remoteUrl = repository.html_url;
  const number = pullRequest.number;
  if (typeof remoteUrl !== 'string' || !remoteUrl.trim()) {
    throw new GitHubPullRequestEventError('GitHub repository html_url is required');
  }
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1) {
    throw new GitHubPullRequestEventError('GitHub pull request number is invalid');
  }
  return {
    provider: 'github',
    remoteIdentity: normalizeRemoteIdentity(remoteUrl),
    number,
  };
}
