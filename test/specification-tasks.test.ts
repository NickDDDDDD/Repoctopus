import { describe, expect, it } from 'vitest';

import {
  parseSpecificationTasks,
  readySpecificationTasks,
} from '../domains/specification/tasks.js';

describe('Specification Tasks', () => {
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
      parseSpecificationTasks(
        'bad-plan',
        '- [ ] 1.1 First.\n  **Blocked by:** 9.9\n',
      ),
    ).toThrow(/unknown or later/u);
  });

  it('changes revision when Task semantics change', () => {
    const first = parseSpecificationTasks('task-plan', '- [ ] 1.1 Build it.\n');
    const changed = parseSpecificationTasks('task-plan', '- [ ] 1.1 Build it safely.\n');
    expect(changed.tasks[0]?.taskRevision).not.toBe(first.tasks[0]?.taskRevision);
    expect(changed.digest).not.toBe(first.digest);
  });
});
