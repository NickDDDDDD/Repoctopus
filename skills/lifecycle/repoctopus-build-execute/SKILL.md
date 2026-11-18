---
name: repoctopus-build-execute
description: Execute only the Runtime-selected Work Package under the frozen Build Configuration.
disable-model-invocation: false
user-invocable: false
metadata:
  repoctopus:
    role: action
    phase: build
    action: execute
---

# Execute one managed package

Execute only the current package, repository bindings, and write scopes. Consume the delivered TDD augmentation when configured. Autonomous mode uses the current Host; subagent-driven-development may delegate only through the attested coordinator capability and must return structured delegation receipts to the parent claim. Do not modify the Plan, configuration, lifecycle phase, current Action, or OpenSpec completion checkbox. Return a structured Outcome bound to the claim and input digest.

For a CLI-mediated Host, save the actual delegation receipts as a JSON array and pass `run work-outcome --delegation-receipts-file <receipts.json>` together with the package result. Each receipt identifies its actual child execution and the current parent invocation. Do not invent receipts or substitute the parent execution identity for a child.

An already completed Task may need implementation repair. Follow the Runtime-selected package and `build.verifyRepair` evidence using the same Task identity. In TDD mode record this execution's real RED, GREEN and regression checks; an old failed Gate ID is not a new TDD receipt. Retained historical completions belong to their original invocations and must not be rewritten.
