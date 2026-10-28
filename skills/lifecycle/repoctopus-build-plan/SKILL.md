---
name: repoctopus-build-plan
description: Project approved OpenSpec Tasks into bounded repository-scoped Work Packages.
disable-model-invocation: false
user-invocable: false
metadata:
  repoctopus:
    role: action
    phase: build
    action: plan
---

# Plan managed Build

Return a structured Build Plan candidate, not Markdown. Every package must reference approved Task identities, repository bindings, write scopes, acceptance criteria, expected outcomes, dependencies, and the supplied validator profile. Cover every Task without inventing requirements or completion checkboxes. Package boundaries and ordering may refine execution; semantic changes belong in Design. Runtime assigns revision and identity after validation.
