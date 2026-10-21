import { describe, expect, it } from 'vitest';

import {
  GitHubMergeRequestAdapter,
  PlatformRequestError,
} from '../platform/github/merge-request.js';

const input = {
  repositoryId: 'repo-1',
  remoteIdentity: 'github.com/team/app',
  sourceBranch: 'feat/change',
  targetBranch: 'main',
  title: 'change',
  body: 'verified',
};

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requestUrl(resource: Parameters<typeof fetch>[0]): string {
  if (resource instanceof URL) return resource.href;
  if (resource instanceof Request) return resource.url;
  return resource;
}

describe('GitHub merge request adapter', () => {
  it('returns every open or closed MR for ambiguity-aware final publication recovery', async () => {
    const calls: string[] = [];
    const adapter = new GitHubMergeRequestAdapter(
      { token: () => Promise.resolve('secret') },
      'https://api.github.test',
      (resource) => {
        calls.push(requestUrl(resource));
        return Promise.resolve(
          response(
            200,
            [7, 8].map((number) => ({
              number,
              html_url: `https://github.com/team/app/pull/${number}`,
              title: 'change',
              body: 'verified',
              state: number === 7 ? 'open' : 'closed',
              merged_at: null,
              merge_commit_sha: null,
              head: { sha: 'head', ref: 'feat/change' },
              base: { ref: 'main' },
            })),
          ),
        );
      },
    );

    await expect(adapter.findAll(input)).resolves.toMatchObject([{ number: 7 }, { number: 8 }]);
    expect(calls[0]).toContain('state=all');
    expect(calls[0]).toContain('head=team%3Afeat%2Fchange');
    expect(calls[0]).toContain('base=main');
    expect(calls[0]).toContain('per_page=100');
  });

  it('reuses an existing MR and never exposes credentials', async () => {
    const calls: Array<{ url: string; authorization: string | null }> = [];
    const request: typeof fetch = (resource, init) => {
      const url = requestUrl(resource);
      calls.push({ url, authorization: new Headers(init?.headers).get('authorization') });
      if (url.includes('/pulls?'))
        return Promise.resolve(
          response(200, [
            {
              number: 7,
              html_url: 'https://github.com/team/app/pull/7',
              title: 'change',
              body: 'verified',
              state: 'open',
              merged_at: null,
              merge_commit_sha: null,
              head: { sha: 'head', ref: 'feat/change' },
              base: { ref: 'main' },
            },
          ]),
        );
      return Promise.resolve(
        response(200, {
          number: 7,
          html_url: 'https://github.com/team/app/pull/7',
          title: 'change',
          body: 'verified',
          state: 'open',
          merged_at: null,
          merge_commit_sha: null,
          head: { sha: 'head', ref: 'feat/change' },
          base: { ref: 'main' },
        }),
      );
    };
    const adapter = new GitHubMergeRequestAdapter(
      { token: () => Promise.resolve('secret-token') },
      'https://api.github.test',
      request,
    );
    const found = await adapter.find(input);
    expect(found).toMatchObject({ number: 7, repositoryId: 'repo-1' });
    expect(await adapter.update(found!, input)).toEqual(found);
    expect(calls.every((call) => call.authorization === 'Bearer secret-token')).toBe(true);
    expect(JSON.stringify(found)).not.toContain('secret-token');
  });

  it('normalizes CI, review and merge evidence', async () => {
    const request: typeof fetch = (resource) => {
      const url = requestUrl(resource);
      if (url.endsWith('/reviews')) return Promise.resolve(response(200, [{ state: 'APPROVED' }]));
      if (url.includes('/commits/')) return Promise.resolve(response(200, { state: 'success' }));
      return Promise.resolve(
        response(200, {
          number: 7,
          html_url: 'https://github.com/team/app/pull/7',
          title: 'change',
          body: 'verified',
          state: 'closed',
          merged_at: '2026-01-01T00:00:00Z',
          merge_commit_sha: 'merge-head',
          head: { sha: 'head', ref: 'feat/change' },
          base: { ref: 'main' },
        }),
      );
    };
    const adapter = new GitHubMergeRequestAdapter(
      { token: () => Promise.resolve('secret') },
      'https://api.github.test',
      request,
    );
    await expect(
      adapter.status({
        provider: 'github',
        repositoryId: 'repo-1',
        number: 7,
        url: 'https://github.com/team/app/pull/7',
      }),
    ).resolves.toMatchObject({
      state: 'merged',
      ci: 'passed',
      review: 'approved',
      mergeCommit: 'merge-head',
    });
  });

  it.each([
    [401, 'authentication'],
    [403, 'permission'],
    [404, 'not_found'],
    [429, 'rate_limited'],
    [500, 'temporary'],
  ] as const)('maps HTTP %s without retaining the response body', async (status, code) => {
    const adapter = new GitHubMergeRequestAdapter(
      { token: () => Promise.resolve('secret') },
      'https://api.github.test',
      () => Promise.resolve(response(status, { message: 'token secret private body' })),
    );
    const error = await adapter.find(input).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PlatformRequestError);
    expect((error as PlatformRequestError).code).toBe(code);
    expect(String(error)).not.toContain('private body');
    expect(String(error)).not.toContain('secret');
  });

  it('reports unsupported branch protection as a non-blocking capability diagnostic', async () => {
    const adapter = new GitHubMergeRequestAdapter(
      { token: () => Promise.resolve('secret') },
      'https://api.github.test',
      () =>
        Promise.resolve(
          response(403, {
            message: 'Upgrade to GitHub Pro or make this repository public to enable this feature.',
          }),
        ),
    );
    await expect(adapter.capability(input.remoteIdentity, 'main')).resolves.toMatchObject({
      status: 'unavailable',
      blocking: false,
      diagnosticCode: 'github.branch-protection.feature_unavailable',
    });
  });
});
