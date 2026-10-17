import type { ProjectConfigReconcileDiff } from './detection.js';
import type { SharedProjectConfig } from './types.js';

function nodeIds(config: SharedProjectConfig): string[] {
  return config.profiles.flatMap((profile) =>
    profile.nodes.map((node) => `${profile.id}/${node.id}`),
  );
}

export function reconcileProjectConfig(
  current: SharedProjectConfig,
  candidate: SharedProjectConfig,
): ProjectConfigReconcileDiff {
  const currentRepositories = new Map(current.repositories.map((item) => [item.id, item]));
  const candidateRepositories = new Map(candidate.repositories.map((item) => [item.id, item]));
  const currentNodes = new Set(nodeIds(current));
  const candidateNodes = new Set(nodeIds(candidate));
  const addedRepositories = [...candidateRepositories.keys()]
    .filter((id) => !currentRepositories.has(id))
    .sort();
  const removedRepositories = [...currentRepositories.keys()]
    .filter((id) => !candidateRepositories.has(id))
    .sort();
  const conflicts: ProjectConfigReconcileDiff['conflicts'] = [];
  for (const [id, repository] of candidateRepositories) {
    const previous = currentRepositories.get(id);
    if (previous && previous.path !== repository.path) {
      conflicts.push({
        field: `repositories.${id}.path`,
        current: previous.path,
        candidate: repository.path,
      });
    }
  }
  if (current.project.id !== candidate.project.id) {
    conflicts.push({
      field: 'project.id',
      current: current.project.id,
      candidate: candidate.project.id,
    });
  }
  const addedNodes = [...candidateNodes].filter((id) => !currentNodes.has(id)).sort();
  const removedNodes = [...currentNodes].filter((id) => !candidateNodes.has(id)).sort();
  return {
    changed:
      addedRepositories.length > 0 ||
      removedRepositories.length > 0 ||
      addedNodes.length > 0 ||
      removedNodes.length > 0 ||
      conflicts.length > 0,
    addedRepositories,
    removedRepositories,
    addedNodes,
    removedNodes,
    conflicts,
  };
}
