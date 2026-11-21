---
name: repoctopus-design-change
description: Produce the four OpenSpec planning artifacts for the Runtime-selected Design Work.
disable-model-invocation: false
user-invocable: false
metadata:
  repoctopus:
    role: action
    phase: design
---

# Design a managed Change

Execute only the selected `specification.plan` Work. Start from the approved Open baseline and use the augmentation delivered for the `design-method` slot, including its resources. Deepen proposal, delta specs, `design.md`, and `tasks.md` in their existing Provider-owned locations.

Keep requirements and observable behavior in specs, engineering decisions in `design.md`, and executable sequencing in `tasks.md`. Update the same four artifacts; do not add a fifth planning artifact, ADR, implementation notes, Build Plan, or alternate ticket authority. Do not approve the plan or advance the phase. Return an Outcome so strict Provider validation and the independent Design Human Decision can run.

Before returning a successful Outcome, inspect `strategyPreference` and any strategy revision request in the delivered change inputs. Verify the affected repositories, actual Task dependencies, delegation boundaries, Host capabilities and test entry points. Recommend execution and TDD independently:

- `autonomous` for bounded or tightly coupled work; `subagent-driven-development` when there are clear responsibilities and an available Host can provide managed delegation receipts. The number of repositories registered in the Workspace alone is not a reason to select multiple agents.
- Normally `tdd` for observable behavior changes and reproducible defects. For documentation without executable behavior, `direct` can be appropriate; explain why and retain applicable validation. A missing test harness is a gap to expose, not automatic permission to skip tests.

Preserve explicit preferences. If another choice is recommended, explain the difference in the current Design decision; never call the recommendation approved. Review remains `standard` and isolation comes from Open, so do not return alternate review or isolation settings. Lack of future execution capabilities must be visible; do not declare unsupported capabilities or silently downgrade an approved strategy.

Return `result.kind = "build-strategy-candidate"` with `schemaVersion: 1`, both `executionMode` and `tddMode`, and `rationale.execution` / `rationale.tdd`. Each rationale has a nonempty `summary` and a bounded nonempty `refs` list referring to project-relative artifacts or Task identities. The allowed execution values are `autonomous` and `subagent-driven-development`; TDD values are `tdd` and `direct`. Supply this as the structured result through `run work-outcome --result-file <file>`, preserving the current claim, invocation and consumed-layer identities. Missing or invalid candidates remain correctable in the same invocation. Runtime validates the result, displays the full choice in the original Design decision and freezes it only after trusted approval.

After the Outcome, handle Runtime `ask` through the decision view and a real Host native question or conversation reply. Open approval is not Design approval. Submit only the exact current response template through `run decide --response-file`, query its original request if the result is unknown, then follow Runtime pull argv. Do not substitute a Work Outcome, silence, or a default choice for user authorization. Use terminal fallback only when no real user interaction context is available.

Every tracked checkbox Task MUST have at least one following metadata line, indented deeper than the checkbox, using exactly `**Acceptance:** <observable criterion>`. Use semicolons for multiple criteria and `**Requirements:** <requirement refs>` for traceability. Unindented text, unbolded labels, legacy aliases, and a verification phrase embedded only in the Task title are not structured Acceptance and will fail strict validation.
