import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertSpecificationTaskAdoption,
  completeSpecificationTaskDocument,
  parseSpecificationTasks,
  readySpecificationTasks,
} from '../domains/specification/tasks.js';

describe('Specification Tasks', () => {
  it.each([
    '- [ ] 1.1 Wait for the MR merge before finishing.\n',
    '- [ ] 1.1 Finalize.\n  **Acceptance:** after Verify completes, record the result\n',
    '- [ ] 1.1 等待一致性审查结果完成后再处理。\n',
  ])('rejects a checkbox that depends on a future Runtime fact', (document) => {
    expect(() => parseSpecificationTasks('future-fact', document)).toThrow(/not Build-scoped/u);
  });

  it('allows Build work that implements Archive behavior', () => {
    expect(() =>
      parseSpecificationTasks(
        'archive-build',
        '- [ ] 1.1 Implement Archive receipt validation.\n  **Acceptance:** unit tests cover exact OID matching\n',
      ),
    ).not.toThrow();
  });

  it('matches golden semantic normalization fixtures', async () => {
    const fixture = (name: string) =>
      readFile(
        path.join(import.meta.dirname, 'fixtures', 'specification-tasks', `${name}.md`),
        'utf8',
      );
    const baseline = parseSpecificationTasks('task-plan', await fixture('baseline'));
    const equivalent = parseSpecificationTasks(
      'task-plan',
      (await fixture('equivalent-format')).replaceAll('\n', '\r\n'),
    );
    expect(equivalent.digest).toBe(baseline.digest);
    expect(equivalent.tasks.map((task) => task.taskRevision)).toEqual(
      baseline.tasks.map((task) => task.taskRevision),
    );
    for (const name of [
      'changed-text',
      'changed-hierarchy',
      'changed-dependency',
      'changed-acceptance',
      'changed-requirement',
    ]) {
      const changed = parseSpecificationTasks('task-plan', await fixture(name));
      expect(changed.digest, name).not.toBe(baseline.digest);
      expect(
        changed.tasks.some(
          (task, index) => task.taskRevision !== baseline.tasks[index]?.taskRevision,
        ),
        name,
      ).toBe(true);
    }
  });

  it('derives stable ids, revisions, serial dependencies, and one ready Task', () => {
    const pending = parseSpecificationTasks(
      'task-plan',
      '# Tasks\n\n- [ ] 1.1 Add the failing test.\n- [ ] 1.2 Implement the behavior.\n- [ ] 1.3 Verify the result.\n',
    );
    const completed = parseSpecificationTasks(
      'task-plan',
      '# Tasks\r\n\r\n- [x] 1.1 Add the failing test.\r\n- [ ] 1.2 Implement the behavior.\r\n- [ ] 1.3 Verify the result.\r\n',
    );

    expect(pending.tasks.map((task) => [task.taskId, task.blockedBy])).toEqual([
      ['1.1', []],
      ['1.2', ['1.1']],
      ['1.3', ['1.2']],
    ]);
    expect(completed.tasks.map((task) => task.taskRevision)).toEqual(
      pending.tasks.map((task) => task.taskRevision),
    );
    expect(completed.digest).toBe(pending.digest);
    expect(readySpecificationTasks(pending.tasks).map((task) => task.taskId)).toEqual(['1.1']);
    expect(readySpecificationTasks(completed.tasks).map((task) => task.taskId)).toEqual(['1.2']);
    expect(pending.tasks[0]?.completion).toBeNull();
    expect(completed.tasks[0]?.completion).toEqual({ source: 'imported-claim' });
  });

  it('distinguishes fresh Runtime receipts from explicit adoption across pending, partial, and complete sets', () => {
    const document = '- [ ] 1.1 First.\n- [ ] 1.2 Second.\n';
    const pending = parseSpecificationTasks('adoption-plan', document);
    const partial = parseSpecificationTasks(
      'adoption-plan',
      '- [x] 1.1 First.\n- [ ] 1.2 Second.\n',
    );
    const complete = parseSpecificationTasks(
      'adoption-plan',
      '- [x] 1.1 First.\n- [x] 1.2 Second.\n',
    );
    expect(() => assertSpecificationTaskAdoption('fresh', pending.tasks)).not.toThrow();
    expect(() => assertSpecificationTaskAdoption('fresh', partial.tasks)).toThrow(
      /cannot adopt pre-completed/u,
    );
    expect(() => assertSpecificationTaskAdoption('fresh', complete.tasks)).toThrow(
      /cannot adopt pre-completed/u,
    );
    expect(() => assertSpecificationTaskAdoption('adopt-existing', partial.tasks)).not.toThrow();
    expect(() => assertSpecificationTaskAdoption('adopt-existing', complete.tasks)).not.toThrow();

    const runtimeCompleted = completeSpecificationTaskDocument({
      changeId: 'adoption-plan',
      taskId: '1.1',
      taskRevision: pending.tasks[0]!.taskRevision,
      workId: 'build:1.1',
      document,
    });
    expect(() =>
      assertSpecificationTaskAdoption('fresh', runtimeCompleted.tasks.tasks),
    ).not.toThrow();
    expect(readySpecificationTasks(runtimeCompleted.tasks.tasks).map((task) => task.taskId)).toEqual([
      '1.2',
    ]);
  });

  it('derives content-addressed Acceptance identities independently from checkbox state', () => {
    const pending = parseSpecificationTasks(
      'acceptance-plan',
      '- [ ] 1.1 Build it.\n  **Acceptance:** Works safely; Emits evidence\n  **Requirements:** runtime#safe, evidence#trace\n',
    );
    const completed = parseSpecificationTasks(
      'acceptance-plan',
      '- [x] 1.1 Build it.\n  **Acceptance:** Emits evidence; Works safely\n  **Requirements:** evidence#trace, runtime#safe\n',
    );

    expect(pending.tasks[0]?.acceptanceCriteria).toHaveLength(2);
    expect(completed.tasks[0]?.acceptanceCriteria).toEqual(pending.tasks[0]?.acceptanceCriteria);
    const criterion = pending.tasks[0]?.acceptanceCriteria[0];
    expect(criterion?.acceptanceId).toMatch(/^acceptance-[a-f0-9]{64}$/u);
    expect(criterion).toMatchObject({
      taskId: '1.1',
      taskRevision: pending.tasks[0]?.taskRevision,
      requirementRefs: ['evidence#trace', 'runtime#safe'],
      source: 'tasks.md#task-1.1',
    });
    expect(() =>
      parseSpecificationTasks(
        'duplicate-acceptance',
        '- [ ] 1.1 Build it.\n  **Acceptance:** Same; **Same**\n',
      ),
    ).toThrow(/duplicate Acceptance/u);
  });

  it('uses explicit Blocked by metadata and rejects ambiguous identities', () => {
    const tasks = parseSpecificationTasks(
      'task-plan',
      '# Tasks\n\n- [ ] 1.1 Foundation.\n  **Blocked by:** None\n- [ ] 1.2 Integration.\n  **Blocked by:** 1.1\n',
    );
    expect(tasks.tasks[1]?.blockedBy).toEqual(['1.1']);
    expect(() =>
      parseSpecificationTasks('bad-plan', '- [ ] 1.1 First.\n- [ ] 1.1 Duplicate.\n'),
    ).toThrow(/duplicated/u);
    expect(() =>
      parseSpecificationTasks('bad-plan', '- [ ] 1.1 First.\n  **Blocked by:** 9.9\n'),
    ).toThrow(/unknown or later/u);
  });

  it('changes revision when Task semantics change', () => {
    const first = parseSpecificationTasks('task-plan', '- [ ] 1.1 Build it.\n');
    const changed = parseSpecificationTasks('task-plan', '- [ ] 1.1 Build it safely.\n');
    expect(changed.tasks[0]?.taskRevision).not.toBe(first.tasks[0]?.taskRevision);
    expect(changed.digest).not.toBe(first.digest);
  });

  it('projects one checkbox idempotently without changing Task semantics', () => {
    const document = '# Tasks\n\n- [ ] 1.1 Build it.\n- [ ] 1.2 Verify it.\n';
    const before = parseSpecificationTasks('task-plan', document);
    const first = completeSpecificationTaskDocument({
      changeId: 'task-plan',
      taskId: '1.1',
      taskRevision: before.tasks[0]!.taskRevision,
      workId: 'work-build-1.1',
      document,
    });
    const replay = completeSpecificationTaskDocument({
      changeId: 'task-plan',
      taskId: '1.1',
      taskRevision: before.tasks[0]!.taskRevision,
      workId: 'work-build-1.1',
      document: first.document,
    });
    expect(first.updated).toBe(true);
    expect(first.document).toContain('- [x] 1.1 Build it.');
    expect(first.tasks.digest).toBe(before.digest);
    expect(first.tasks.tasks[0]?.completion).toEqual({
      source: 'runtime-work',
      workId: 'work-build-1.1',
    });
    expect(replay.tasks.tasks[0]?.completion).toEqual({
      source: 'runtime-work',
      workId: 'work-build-1.1',
    });
    expect(replay).toMatchObject({ updated: false, document: first.document });
    expect(() =>
      completeSpecificationTaskDocument({
        changeId: 'task-plan',
        taskId: '1.1',
        taskRevision: `sha256:${'f'.repeat(64)}`,
        document,
      }),
    ).toThrow(/revision changed/u);
  });
});
