---
name: repoctopus-build-configure
description: Inspect Runtime-provided topology and Host facts to propose one bounded Build Configuration.
disable-model-invocation: false
user-invocable: false
metadata:
  repoctopus:
    role: action
    phase: build
    action: configure
---

# Configure managed Build

Inspect only the supplied OpenSpec Tasks, repository topology, workspace intent, checkout binding, and Host capabilities. Return the supported execution, TDD, review, and isolation values as a structured proposal. Do not create or switch a branch or worktree, implement code, select the next Action, or silently downgrade an unavailable capability. Runtime validates the proposal and a trusted human approves it.
