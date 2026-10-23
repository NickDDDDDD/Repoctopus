import { createHash } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';
import type { SpecificationTask, SpecificationTaskSet } from './types.js';

const TASK = /^(\s*)-\s+\[([ xX])\]\s+(\d+(?:\.\d+)*)\s+(.+?)\s*$/u;
const BLOCKED_BY = /^\s*(?:-\s*)?(?:\*\*)?Blocked by:(?:\*\*)?\s*(.+?)\s*$/iu;

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
  return [...new Set(dependencies)];
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
  }> = [];
  for (const line of document.replaceAll('\r\n', '\n').split('\n')) {
    const task = line.match(TASK);
    if (task) {
      parsed.push({
        taskId: task[3]!,
        title: task[4]!.trim(),
        level: task[1]!.replaceAll('\t', '  ').length,
        status: task[2]!.toLowerCase() === 'x' ? 'completed' : 'pending',
        explicitDependencies: null,
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
    };
    return { ...stable, status: task.status, taskRevision: sha256(stable) };
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
