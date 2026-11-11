---
name: repoctopus-open-change
description: Establish the complete four-artifact OpenSpec baseline for a Runtime-selected Open Work.
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
3. Consume the delivered `grilling` augmentation. Verify every answer available from repositories, existing specs, configuration, and Provider facts before asking a person. Ask only about a material unresolved frontier; when none remains, finish with zero questions.
4. Create or repair exactly the Provider-owned proposal, delta specs, `design.md`, and `tasks.md`. Treat them as one reviewable Open baseline; do not create an ADR, implementation notes, Build Plan, ticket authority, or fifth planning artifact.
5. Record explicit task Acceptance and requirement traceability, and report which repository/spec facts were checked.
6. Report a Host Outcome. Do not approve Open, claim that Open is complete, or select Design yourself; strict Provider validation and the Runtime-owned Human Decision happen afterward.

When the subsequent Runtime continuation is `ask`, read its Human Decision argv. Present the exact materials and allowed choices using the Host native question tool, or conversation options if no native tool exists. Wait for the real reply (or explicit delegation still covering this proposal), fill the response template, and submit through `run decide --response-file`. No answer or preselected option is not approval. Missing real interaction context requires terminal fallback. Query the original request after an unknown result; follow returned pull argv after acceptance.

Stop with a failed Outcome when the Provider protocol, write scope, or repository identity is missing or drifted.
