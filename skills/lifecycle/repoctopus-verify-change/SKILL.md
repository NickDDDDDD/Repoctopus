---
name: repoctopus-verify-change
description: Review the completed Change before Repoctopus runs its evidence gates.
disable-model-invocation: false
user-invocable: false
metadata:
  repoctopus:
    role: action
    phase: verify
---

# Verify a managed Change

Review the implementation against the approved specification, tasks, repository state, and the code-review augmentation in the packet. Report concrete findings and whether the Change is ready for automated evidence.

Do not treat command success as review completion, fabricate evidence, or advance Archive. A succeeded Host Outcome is only the prerequisite for Repoctopus Evidence and Validator gates.
