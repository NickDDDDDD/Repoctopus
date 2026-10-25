---
name: repoctopus-build-task
description: Implement exactly one Runtime-selected OpenSpec task under TDD and codebase design constraints.
disable-model-invocation: false
user-invocable: false
metadata:
  repoctopus:
    role: action
    phase: build
---

# Build one managed task

Execute exactly the task identity and revision in the packet. Consume the TDD and codebase-design augmentations before the first protected write: establish a failing behavioral test, make the smallest coherent implementation pass, then refactor with the test green.

Do not edit the task checkbox or declare it complete. Return an Outcome; the Provider validator alone projects an accepted Receipt into `tasks.md`.
