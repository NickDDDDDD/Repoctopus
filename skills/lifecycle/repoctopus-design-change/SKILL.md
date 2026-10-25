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

Execute only the selected `specification.plan` Work. Read the Provider instructions and templates in the packet, then create or repair proposal, delta specs, design, and tasks in their Provider-owned locations.

Keep requirements and observable behavior in specs, engineering decisions in `design.md`, and executable sequencing in `tasks.md`. Do not add a fifth planning artifact, approve the plan, or advance the phase. Return an Outcome so strict Provider validation and the Human Decision gate can run.
