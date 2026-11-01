function stripGitSuffix(value: string): string {
  return value.replace(/\.git\/?$/i, '').replace(/\/$/, '');
}

export function normalizeRemoteIdentity(remote: string): string {
  const trimmed = remote.trim();
  if (/^[^/@\s]+@[^:\s]+:.+$/.test(trimmed)) {
    const match = /^[^@]+@([^:]+):(.+)$/.exec(trimmed);
    if (match) return stripGitSuffix(`${match[1]}/${match[2]}`).toLowerCase();
  }
  try {
    const url = new URL(trimmed);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return stripGitSuffix(`${url.hostname}${url.pathname}`).toLowerCase();
  } catch {
    return stripGitSuffix(trimmed).replaceAll('\\', '/');
  }
}

export interface PublicationRepositoryIdentity {
  value: string;
  certainty: 'exact' | 'platform-rule' | 'conservative';
  source: 'stable-id' | 'remote';
}

export function normalizePublicationRepositoryIdentity(input: {
  stableRepositoryId?: string | null;
  remote: string;
}): PublicationRepositoryIdentity {
  const stableRepositoryId = input.stableRepositoryId?.trim();
  if (stableRepositoryId) {
    return { value: stableRepositoryId, certainty: 'exact', source: 'stable-id' };
  }
  const remote = input.remote.trim();
  if (!remote) throw new Error('Publication remote identity is required');
  let host: string;
  let repositoryPath: string;
  const scp = /^[^/@\s]+@([^:\s]+):(.+)$/u.exec(remote);
  if (scp) {
    host = scp[1]!.toLowerCase();
    repositoryPath = stripGitSuffix(scp[2]!.replaceAll('\\', '/')).replace(/^\/+|\/+$/gu, '');
  } else {
    try {
      const url = new URL(remote);
      host = url.hostname.toLowerCase();
      repositoryPath = stripGitSuffix(url.pathname.replaceAll('\\', '/')).replace(
        /^\/+|\/+$/gu,
        '',
      );
    } catch {
      const normalized = stripGitSuffix(remote.replaceAll('\\', '/'));
      const separator = normalized.indexOf('/');
      if (separator <= 0) {
        throw new Error('Publication remote identity must include a host and repository path');
      }
      host = normalized.slice(0, separator).toLowerCase();
      repositoryPath = normalized.slice(separator + 1).replace(/^\/+|\/+$/gu, '');
    }
  }
  if (!repositoryPath) throw new Error('Publication remote repository path is required');
  if (host === 'github.com') {
    return {
      value: `${host}/${repositoryPath.toLowerCase()}`,
      certainty: 'platform-rule',
      source: 'remote',
    };
  }
  return {
    value: `${host}/${repositoryPath}`,
    certainty: 'conservative',
    source: 'remote',
  };
}
