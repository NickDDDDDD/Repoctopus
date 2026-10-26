---
name: repoctopus-build-task
description: Implement exactly one Runtime-selected OpenSpec task using the delivered TDD method.
disable-model-invocation: false
user-invocable: false
metadata:
  repoctopus:
    role: action
    phase: build
---

# Build one managed task

Execute exactly the task identity and revision in the packet. Consume the delivered `tdd` augmentation before the first protected write: establish a failing behavioral test, make the smallest coherent implementation pass, then refactor with the test green. Build does not reload the Design-phase `codebase-design` Skill; if implementation exposes an invalid design assumption, report a bounded structured finding and let Runtime request the Human Decision.

Do not edit the task checkbox or declare it complete. Return an Outcome; the Provider validator alone projects an accepted Receipt into `tasks.md`.
