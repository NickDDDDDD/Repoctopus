import type {
  CredentialProvider,
  FinalMergeRequestPort,
  MergeRequestInput,
} from '../../domains/delivery/ports.js';
import type {
  MergeRequestIdentity,
  MergeRequestStatus,
  PlatformCapability,
} from '../../domains/delivery/types.js';

interface GitHubPull {
  number: number;
  html_url: string;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  merged_at: string | null;
  merge_commit_sha: string | null;
  head: { sha: string; ref: string };
  base: { ref: string };
}

export class PlatformRequestError extends Error {
  constructor(
    public readonly code:
      | 'authentication'
      | 'permission'
      | 'feature_unavailable'
      | 'not_found'
      | 'rate_limited'
      | 'temporary'
      | 'invalid_response',
    message: string,
  ) {
    super(message);
    this.name = 'PlatformRequestError';
  }
}

function repositoryPath(remoteIdentity: string): string {
  const normalized = remoteIdentity.replace(/^https?:\/\//, '').replace(/\.git$/, '');
  const [host, owner, repository] = normalized.split('/');
  if (!host || !owner || !repository || !/github/i.test(host))
    throw new Error(`Unsupported GitHub remote identity: ${remoteIdentity}`);
  return `${owner}/${repository}`;
}

function identity(repositoryId: string, pull: GitHubPull): MergeRequestIdentity {
  return { provider: 'github', repositoryId, number: pull.number, url: pull.html_url };
}

export class GitHubMergeRequestAdapter implements FinalMergeRequestPort {
  constructor(
    private readonly credentials: CredentialProvider,
    private readonly apiBaseUrl = 'https://api.github.com',
    private readonly request: typeof fetch = fetch,
  ) {}

  async capability(remoteIdentity: string, targetBranch: string): Promise<PlatformCapability> {
    try {
      await this.call(
        `/repos/${repositoryPath(remoteIdentity)}/branches/${encodeURIComponent(targetBranch)}/protection`,
      );
      return {
        name: 'branch-protection',
        status: 'available',
        blocking: false,
        diagnosticCode: 'github.branch-protection.available',
      };
    } catch (error) {
      if (error instanceof PlatformRequestError) {
        const status =
          error.code === 'feature_unavailable'
            ? 'unavailable'
            : error.code === 'permission'
              ? 'permission_denied'
              : error.code === 'not_found'
                ? 'misconfigured'
                : 'unknown';
        return {
          name: 'branch-protection',
          status,
          blocking: false,
          diagnosticCode: `github.branch-protection.${error.code}`,
        };
      }
      throw error;
    }
  }

  async find(input: MergeRequestInput): Promise<MergeRequestIdentity | null> {
    const pulls = await this.findPulls(input, 'open');
    const pull = pulls[0];
    return pull ? identity(input.repositoryId, pull) : null;
  }

  async findAll(input: MergeRequestInput): Promise<MergeRequestIdentity[]> {
    const pulls = await this.findPulls(input, 'all');
    return pulls.map((pull) => identity(input.repositoryId, pull));
  }

  private findPulls(input: MergeRequestInput, state: 'open' | 'all'): Promise<GitHubPull[]> {
    const repository = repositoryPath(input.remoteIdentity);
    const owner = repository.split('/')[0]!;
    return this.call<GitHubPull[]>(
      `/repos/${repository}/pulls?state=${state}&head=${encodeURIComponent(`${owner}:${input.sourceBranch}`)}&base=${encodeURIComponent(input.targetBranch)}&per_page=100`,
    );
  }

  async create(input: MergeRequestInput): Promise<MergeRequestIdentity> {
    const pull = await this.call<GitHubPull>(
      `/repos/${repositoryPath(input.remoteIdentity)}/pulls`,
      {
        method: 'POST',
        body: JSON.stringify({
          title: input.title,
          body: input.body,
          head: input.sourceBranch,
          base: input.targetBranch,
        }),
      },
    );
    return identity(input.repositoryId, pull);
  }

  async update(
    current: MergeRequestIdentity,
    input: MergeRequestInput,
  ): Promise<MergeRequestIdentity> {
    const pull = await this.call<GitHubPull>(
      `/repos/${repositoryPath(input.remoteIdentity)}/pulls/${current.number}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ title: input.title, body: input.body, base: input.targetBranch }),
      },
    );
    return identity(input.repositoryId, pull);
  }

  async status(current: MergeRequestIdentity): Promise<MergeRequestStatus> {
    const repository = this.repositoryFromUrl(current.url);
    const pull = await this.call<GitHubPull>(`/repos/${repository}/pulls/${current.number}`);
    const [combined, reviews] = await Promise.all([
      this.call<{ state: 'pending' | 'success' | 'failure' | 'error' }>(
        `/repos/${repository}/commits/${pull.head.sha}/status`,
      ),
      this.call<Array<{ state: string }>>(`/repos/${repository}/pulls/${current.number}/reviews`),
    ]);
    const reviewStates = reviews.map((review) => review.state.toUpperCase());
    const review = reviewStates.includes('CHANGES_REQUESTED')
      ? 'changes_requested'
      : reviewStates.includes('APPROVED')
        ? 'approved'
        : 'pending';
    const ci =
      combined.state === 'success' ? 'passed' : combined.state === 'pending' ? 'pending' : 'failed';
    return {
      ...current,
      state: pull.merged_at ? 'merged' : pull.state,
      sourceBranch: pull.head.ref,
      targetBranch: pull.base.ref,
      headCommit: pull.head.sha,
      title: pull.title,
      body: pull.body ?? '',
      ci,
      review,
      conversationsResolved: null,
      mergeCommit: pull.merge_commit_sha,
      mergedAt: pull.merged_at,
    };
  }

  private repositoryFromUrl(url: string): string {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 2) throw new Error('Invalid GitHub MR URL');
    return `${parts[0]}/${parts[1]}`;
  }

  private async call<T = unknown>(resource: string, init: RequestInit = {}): Promise<T> {
    const token = await this.credentials.token();
    const response = await this.request(
      new URL(`${this.apiBaseUrl.replace(/\/$/, '')}${resource}`),
      {
        ...init,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(init.headers ?? {}),
        },
      },
    );
    if (!response.ok) {
      let featureUnavailable = false;
      if (response.status === 403) {
        try {
          const detail = (await response.clone().json()) as { message?: unknown };
          featureUnavailable =
            typeof detail.message === 'string' &&
            /upgrade to github pro|make this repository public/i.test(detail.message);
        } catch {
          featureUnavailable = false;
        }
      }
      const code =
        response.status === 401
          ? 'authentication'
          : response.status === 403
            ? featureUnavailable
              ? 'feature_unavailable'
              : 'permission'
            : response.status === 404
              ? 'not_found'
              : response.status === 429
                ? 'rate_limited'
                : response.status >= 500
                  ? 'temporary'
                  : 'invalid_response';
      throw new PlatformRequestError(code, `GitHub request failed with status ${response.status}`);
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new PlatformRequestError('invalid_response', 'GitHub returned invalid JSON');
    }
  }
}

export class EnvironmentCredentialProvider implements CredentialProvider {
  constructor(
    private readonly environment: NodeJS.ProcessEnv,
    private readonly variable = 'GITHUB_TOKEN',
  ) {}
  token(): Promise<string> {
    const value = this.environment[this.variable];
    if (!value) throw new Error(`Missing credential environment variable: ${this.variable}`);
    return Promise.resolve(value);
  }
}
