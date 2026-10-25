---
name: repoctopus-open-change
description: Execute the Runtime-selected Open intake Work for a Change without advancing lifecycle state.
disable-model-invocation: false
user-invocable: false
metadata:
  repoctopus:
    role: action
    phase: open
---

# Open a managed Change

You are executing one immutable `change.intake` packet selected by Repoctopus Runtime.

1. Read every packet layer before any protected operation.
2. Confirm the Specification Store and repository identities from the packet; never infer absolute paths.
3. Create or repair only the minimal change metadata allowed by the Provider protocol and write scope.
4. Report a Host Outcome. Do not claim that Open is complete and do not select Design yourself.

Stop with a failed Outcome when the Provider protocol, write scope, or repository identity is missing or drifted.
