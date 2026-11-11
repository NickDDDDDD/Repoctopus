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

Execute only the selected `specification.plan` Work. Start from the approved Open baseline, consume the delivered `codebase-design` augmentation, and deepen proposal, delta specs, `design.md`, and `tasks.md` in their existing Provider-owned locations.

Keep requirements and observable behavior in specs, engineering decisions in `design.md`, and executable sequencing in `tasks.md`. Update the same four artifacts; do not add a fifth planning artifact, ADR, implementation notes, Build Plan, or alternate ticket authority. Do not approve the plan or advance the phase. Return an Outcome so strict Provider validation and the independent Design Human Decision can run.

After the Outcome, handle Runtime `ask` through the decision view and a real Host native question or conversation reply. Open approval is not Design approval. Submit only the exact current response template through `run decide --response-file`, query its original request if the result is unknown, then follow Runtime pull argv. Do not substitute a Work Outcome, silence, or a default choice for user authorization. Use terminal fallback only when no real user interaction context is available.

Every tracked checkbox Task MUST have at least one following metadata line, indented deeper than the checkbox, using exactly `**Acceptance:** <observable criterion>`. Use semicolons for multiple criteria and `**Requirements:** <requirement refs>` for traceability. Unindented text, unbolded labels, legacy aliases, and a verification phrase embedded only in the Task title are not structured Acceptance and will fail strict validation.
