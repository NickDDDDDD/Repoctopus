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
