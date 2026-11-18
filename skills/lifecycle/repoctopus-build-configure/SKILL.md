---
name: repoctopus-build-configure
description: Verify the approved strategy against Runtime-provided topology and Host binding facts.
disable-model-invocation: false
user-invocable: false
metadata:
  repoctopus:
    role: action
    phase: build
    action: configure
---

# Configure managed Build

Inspect the supplied approved BuildStrategy, OpenSpec Tasks, repository topology, workspace intent, checkout binding and Host facts. Return the `execution-binding-candidate` result referencing the exact approved `strategyDigest`. Execution and TDD have already been shown and approved in Design; do not select them again, reinterpret absent preferences, or request another routine configuration approval. Runtime validates the independent ExecutionBinding. Each later Work claims only its own required capabilities; no compatible Host means blocked execution, not permission to switch strategy. Do not create or switch a branch or worktree, implement code, select the next Action, or silently downgrade capabilities. Explicit strategy changes must follow Runtime's strategy revision path and a current Design decision.
