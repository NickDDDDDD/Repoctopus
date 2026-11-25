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

Execute only the current package, its declared repositories, and its write scopes. Surface an undeclared repository dependency to Runtime instead of consuming it silently. Consume the delivered TDD augmentation when configured. Autonomous mode uses the current Host; subagent-driven-development may delegate only through the attested coordinator capability and must return structured delegation receipts to the parent claim. Do not modify the Plan, configuration, lifecycle phase, current Action, or OpenSpec completion checkbox. Return a structured Outcome bound to the claim and input digest.

For a CLI-mediated Host, save the actual delegation receipts as a JSON array and pass `run work-outcome --delegation-receipts-file <receipts.json>` together with the package result. Each receipt identifies its actual child execution and the current parent invocation. Do not invent receipts or substitute the parent execution identity for a child.

For the local desktop, report actual child Agent boundaries while the parent claim is active. After the host confirms a spawn, use the child ID returned by its delegation tool:

```text
repoctopus run work-activity --run <run> --runner <claim-runner> --host-id <host-id> --invocation-id <parent-invocation> --packet-digest <packet-digest> --child-execution-id <child-id> --delegation-role implementer --delegation-stage started --json
```

Use `reviewer` for review. Add `--task-id` and `--repository-id` when the child's actual assignment is known and is within the current package. Reuse the same identity and assignment for `verifying` when evidence confirms that the child has started verification, and for `returned` when the delegation tool returns the child's result. Do not infer intermediate progress or use placeholder IDs. A missing or rejected observation does not replace or delay the required Outcome and delegation receipts.

When `build.revalidateCompletion` is present, the historical completion was invalidated by a changed read input. Re-run the current acceptance, GREEN and regression checks against that input. If the implementation remains identical, use the historical RED identity from this completion with new GREEN and regression evidence. If the implementation must change, record real RED/GREEN for that repair. Do not change the existing code to manufacture RED.

An already completed Task may need implementation repair. Follow the Runtime-selected package and `build.verifyRepair` evidence using the same Task identity. In TDD mode record this execution's real RED, GREEN and regression checks; an old failed Gate ID is not a new TDD receipt. Retained historical completions belong to their original invocations and must not be rewritten.
