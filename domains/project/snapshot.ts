import { createHash } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';
import type { ProjectReconciliation, ProjectSnapshot, RepositorySnapshot } from './types.js';

type SnapshotWithoutDigest = Omit<ProjectSnapshot, 'digest'>;

export function hashProjectSnapshot(snapshot: SnapshotWithoutDigest): string {
  const stableSnapshot = {
    schemaVersion: snapshot.schemaVersion,
    projectId: snapshot.projectId,
    root: snapshot.root,
    repositories: snapshot.repositories,
    diagnostics: snapshot.diagnostics,
  };
  return createHash('sha256').update(canonicalJson(stableSnapshot)).digest('hex');
}

export function createProjectSnapshot(value: SnapshotWithoutDigest): ProjectSnapshot {
  return { ...value, digest: hashProjectSnapshot(value) };
}

function changedFields(
  previous: RepositorySnapshot,
  current: RepositorySnapshot,
): ProjectReconciliation['changedRepositories'][number]['fields'] {
  const fields: ProjectReconciliation['changedRepositories'][number]['fields'] = [];
  if (previous.path !== current.path) fields.push('path');
  if (previous.remoteIdentity !== current.remoteIdentity) fields.push('remoteIdentity');
  if (previous.branch !== current.branch) fields.push('branch');
  if (previous.head !== current.head) fields.push('head');
  if (previous.worktree.digest !== current.worktree.digest) fields.push('worktree');
  return fields;
}

export function reconcileProjectSnapshots(
  previous: ProjectSnapshot,
  current: ProjectSnapshot,
): ProjectReconciliation {
  const previousById = new Map(
    previous.repositories.map((repository) => [repository.id, repository]),
  );
  const currentById = new Map(
    current.repositories.map((repository) => [repository.id, repository]),
  );
  const added = [...currentById.keys()].filter((id) => !previousById.has(id)).sort();
  const removed = [...previousById.keys()].filter((id) => !currentById.has(id)).sort();
  const changedRepositories = [...currentById.entries()]
    .flatMap(([id, repository]) => {
      const before = previousById.get(id);
      if (!before) return [];
      const fields = changedFields(before, repository);
      return fields.length > 0
        ? [{ repositoryId: id, repositoryName: repository.name, fields }]
        : [];
    })
    .sort((left, right) => left.repositoryId.localeCompare(right.repositoryId));
  const changed = previous.digest !== current.digest;
  const repositoryNamesChanged = [...currentById.entries()].some(
    ([id, repository]) => previousById.get(id)?.name !== repository.name,
  );
  const diagnosticsChanged =
    canonicalJson(previous.diagnostics) !== canonicalJson(current.diagnostics);
  const identityChanged =
    changed &&
    (previous.projectId !== current.projectId ||
      previous.root !== current.root ||
      diagnosticsChanged ||
      repositoryNamesChanged ||
      added.length > 0 ||
      removed.length > 0 ||
      changedRepositories.some((repository) =>
        repository.fields.some((field) => ['path', 'remoteIdentity', 'branch'].includes(field)),
      ) ||
      changedRepositories.length === 0);
  const changeClass: ProjectReconciliation['changeClass'] = !changed
    ? 'same'
    : identityChanged
      ? 'identity'
      : 'content';

  return {
    changed,
    changeClass,
    requiresReconciliation: changeClass === 'identity',
    previousDigest: previous.digest,
    currentDigest: current.digest,
    added,
    removed,
    changedRepositories,
  };
}
