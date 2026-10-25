import { createHash } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';
import type { SpecificationTask, SpecificationTaskSet } from './types.js';

const TASK = /^(\s*)-\s+\[([ xX])\]\s+(\d+(?:\.\d+)*)\s+(.+?)\s*$/u;
const BLOCKED_BY = /^\s*(?:-\s*)?(?:\*\*)?Blocked by:(?:\*\*)?\s*(.+?)\s*$/iu;
const ACCEPTANCE = /^\s*(?:-\s*)?(?:\*\*)?Acceptance(?: criteria)?:(?:\*\*)?\s*(.+?)\s*$/iu;
const REQUIREMENTS = /^\s*(?:-\s*)?(?:\*\*)?Requirements?(?: mappings?)?:(?:\*\*)?\s*(.+?)\s*$/iu;
const FUTURE_PHASE_DEPENDENCY = [
  /\b(?:after|once|when)\b.*\b(?:verify|verification|archive|merge request|mr|consistency review)\b.*\b(?:complete[sd]?|merged?|result|verdict|passes?)\b/iu,
  /\b(?:wait(?:ing)? for|depends? on)\b.*\b(?:verification|archive|merge request|mr merge|consistency review)\b/iu,
  /(?:等待|依赖).*(?:验证|归档|MR|合入|一致性审查).*(?:完成|结果|结论|通过|合入)/u,
] as const;

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function parseDependencies(value: string): string[] {
  if (/^none(?:\s|$)/iu.test(value)) return [];
  const dependencies = value
    .split(',')
    .map((entry) => entry.trim().match(/^`?(\d+(?:\.\d+)*)`?(?:\s|$)/u)?.[1])
    .filter((entry): entry is string => entry !== undefined);
  if (dependencies.length === 0) throw new Error('Task Blocked by metadata contains no task ids');
  return [...new Set(dependencies)].sort();
}

function normalizeText(value: string): string {
  return value
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/\*\*([^*]+)\*\*/gu, '$1')
    .replace(/__([^_]+)__/gu, '$1')
    .replace(/~~([^~]+)~~/gu, '$1')
    .replace(/\*([^*]+)\*/gu, '$1')
    .replace(/_([^_]+)_/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim();
}

function semanticList(value: string, separator: RegExp): string[] {
  return [...new Set(value.split(separator).map(normalizeText).filter(Boolean))].sort();
}

export function assertBuildScopedTask(
  task: Pick<SpecificationTask, 'taskId' | 'title' | 'acceptanceCriteria'>,
): void {
  const dependency = [task.title, ...task.acceptanceCriteria].find((text) =>
    FUTURE_PHASE_DEPENDENCY.some((pattern) => pattern.test(text)),
  );
  if (dependency) {
    throw new Error(
      `Task ${task.taskId} is not Build-scoped; future Verify, Archive, MR merge, and consistency outcomes are Runtime facts: ${dependency}`,
    );
  }
}

export function parseSpecificationTasks(
  changeId: string,
  document: string,
): SpecificationTaskSet {
  if (!changeId.trim()) throw new Error('Specification task change id is required');
  const parsed: Array<{
    taskId: string;
    title: string;
    level: number;
    status: SpecificationTask['status'];
    explicitDependencies: string[] | null;
    acceptanceCriteria: string[];
    requirementRefs: string[];
  }> = [];
  for (const line of document.replaceAll('\r\n', '\n').split('\n')) {
    const task = line.match(TASK);
    if (task) {
      const indentation = task[1]!.replaceAll('\t', '  ').length;
      if (indentation % 2 !== 0) {
        throw new Error(`Task ${task[3]!} has ambiguous hierarchy indentation`);
      }
      parsed.push({
        taskId: task[3]!,
        title: normalizeText(task[4]!),
        level: indentation / 2,
        status: task[2]!.toLowerCase() === 'x' ? 'completed' : 'pending',
        explicitDependencies: null,
        acceptanceCriteria: [],
        requirementRefs: [],
      });
      continue;
    }
    const dependency = line.match(BLOCKED_BY);
    if (dependency && parsed.length > 0) {
      const current = parsed.at(-1)!;
      if (current.explicitDependencies !== null) {
        throw new Error(`Task ${current.taskId} declares Blocked by more than once`);
      }
      current.explicitDependencies = parseDependencies(dependency[1]!);
      continue;
    }
    const acceptance = line.match(ACCEPTANCE);
    if (acceptance && parsed.length > 0) {
      parsed.at(-1)!.acceptanceCriteria.push(...semanticList(acceptance[1]!, /;/u));
      continue;
    }
    const requirements = line.match(REQUIREMENTS);
    if (requirements && parsed.length > 0) {
      parsed.at(-1)!.requirementRefs.push(...semanticList(requirements[1]!, /,/u));
    }
  }
  if (parsed.length === 0) throw new Error('Tasks document contains no official checkbox tasks');
  const ids = new Set<string>();
  const tasks = parsed.map((task, index): SpecificationTask => {
    if (ids.has(task.taskId)) throw new Error(`Task id is duplicated: ${task.taskId}`);
    const blockedBy = task.explicitDependencies ?? (index === 0 ? [] : [parsed[index - 1]!.taskId]);
    for (const dependency of blockedBy) {
      if (!ids.has(dependency)) {
        throw new Error(`Task ${task.taskId} is blocked by unknown or later task: ${dependency}`);
      }
    }
    ids.add(task.taskId);
    const stable = {
      taskId: task.taskId,
      title: task.title,
      level: task.level,
      blockedBy,
      acceptanceCriteria: [...new Set(task.acceptanceCriteria)].sort(),
      requirementRefs: [...new Set(task.requirementRefs)].sort(),
    };
    const projected = { ...stable, status: task.status, taskRevision: sha256(stable) };
    if (projected.status === 'pending') assertBuildScopedTask(projected);
    return projected;
  });
  return {
    schemaVersion: 1,
    changeId,
    tasks,
    digest: sha256({
      schemaVersion: 1,
      changeId,
      tasks: tasks.map((task) => ({
        taskId: task.taskId,
        taskRevision: task.taskRevision,
        title: task.title,
        level: task.level,
        blockedBy: task.blockedBy,
        acceptanceCriteria: task.acceptanceCriteria,
        requirementRefs: task.requirementRefs,
      })),
    }),
  };
}

export function readySpecificationTasks(tasks: readonly SpecificationTask[]): SpecificationTask[] {
  const completed = new Set(
    tasks.filter((task) => task.status === 'completed').map((task) => task.taskId),
  );
  return tasks.filter(
    (task) =>
      task.status === 'pending' && task.blockedBy.every((dependency) => completed.has(dependency)),
  );
}

export function completeSpecificationTaskDocument(input: {
  changeId: string;
  taskId: string;
  taskRevision: `sha256:${string}`;
  document: string;
}): { document: string; tasks: SpecificationTaskSet; updated: boolean } {
  const before = parseSpecificationTasks(input.changeId, input.document);
  const task = before.tasks.find((candidate) => candidate.taskId === input.taskId);
  if (!task) throw new Error(`Specification Task does not exist: ${input.taskId}`);
  if (task.taskRevision !== input.taskRevision) {
    throw new Error(`Specification Task revision changed: ${input.taskId}`);
  }
  if (task.status === 'completed') {
    return { document: input.document, tasks: before, updated: false };
  }
  const escaped = input.taskId.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const pattern = new RegExp(
    `^(\\s*-\\s+\\[)[ ](\\]\\s+${escaped}(?:\\s|$).*)$`,
    'gmu',
  );
  let replacements = 0;
  const document = input.document.replace(pattern, (_match, prefix: string, suffix: string) => {
    replacements += 1;
    return `${prefix}x${suffix}`;
  });
  if (replacements !== 1) {
    throw new Error(`Specification Task checkbox is not uniquely writable: ${input.taskId}`);
  }
  const tasks = parseSpecificationTasks(input.changeId, document);
  const completed = tasks.tasks.find((candidate) => candidate.taskId === input.taskId);
  if (completed?.status !== 'completed' || completed.taskRevision !== input.taskRevision) {
    throw new Error(`Specification Task completion changed its semantic revision: ${input.taskId}`);
  }
  return { document, tasks, updated: true };
}
