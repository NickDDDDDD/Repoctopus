---
change: repair-atomic-work-outcome-acceptance
design-doc: openspec/changes/repair-atomic-work-outcome-acceptance/design.md
base-ref: eafdd756a9a1d2cbb68c559a5ed57d331c552910
archived-with: 2026-11-06-repair-atomic-work-outcome-acceptance
---

# Repair atomic Work Outcome acceptance implementation plan

<!-- comet-task-authority: openspec/changes/repair-atomic-work-outcome-acceptance/tasks.md -->

## Implementation constraints

- `openspec/changes/repair-atomic-work-outcome-acceptance/tasks.md` is the only completion authority. This plan maps stable task IDs into executable work packages and does not create another checklist.
- Use the approved `autonomous + tdd + thorough` configuration. Every behavior slice starts with a test that fails for the intended reason, receives the smallest architecture-safe implementation, then runs affected regressions before its task is completed.
- Fixed behavior reference is Comet 0.5.1 commit `35c9860b77b42bafa0c2d80d8d695889f888a924`. Adopt its invariant that application contract, output schema, step validator and transition feasibility all precede terminal Outcome installation; do not import or package Comet Runtime/SDK.
- Preserve Repoctopus authority boundaries: domain modules define deterministic candidate validation, Cordis Services orchestrate Provider and Project Snapshot I/O, Engine/Run Store owns guarded state transitions, and platform adapters never select continuation.
- Every successful Build Host submission remains pending until the current Work processor returns an accepted validation record. There is no Work-kind immediate/delayed acceptance list and no Configure-only escape hatch.
- Correctable candidate rejection preserves Work, claim, attempt, checkEpoch, packet and invocation. Runtime processing failure preserves the pending submission. Only an execution whose result is genuinely unknown enters reconciliation.
- Validation may read external facts outside the Run lock, but terminal acceptance must recheck all stable identities and digests in one guarded commit. External I/O and Execute side effects never run inside that commit.
- Keep Execute workspace checkpoint and side-effect journal as a two-stage protocol. The unified acceptance boundary validates the completion candidate; it does not pretend Git/process side effects are part of one storage transaction.
- Do not migrate or hand-edit the old Round 8 Run. Use it only as evidence, then replay the scenario with a new Run after the implementation passes.
- This pre-1.0 change removes obsolete branches instead of adding compatibility aliases. Each coherent commit is pushed immediately; temporary logs and scratch outputs are removed after verification.

## Work package 1: Reproduce the terminalization defect and freeze its invariants

<!-- comet-task-ref:f1487e82-4388-447a-8b35-6a00092072f8 -->
<!-- comet-task-ref:52f937f1-5299-4c08-95a2-42177bb5f078 -->
<!-- comet-task-ref:267276ab-5fb7-4dca-9a0e-cbea05bf669c -->

Add the exact Round 8 scenario to the production managed-change E2E: `build.configure` returns an `execution-binding-candidate` with the correct structural kind and a wrong Strategy digest. The first RED assertion must prove the current implementation installs terminal execution facts before `WorkflowRuns` rejects the candidate.

Add lower-level authority and executor assertions that no accepted submission, Host Outcome, Action Outcome or Receipt may exist before complete validation. Preserve and assert the original Work, claim, attempt, checkEpoch, invocation, packet and input identities.

Document the current acceptance entry points and special cases in the approved Design. Use source search to prove the inventory includes embedded execution, external outcome submission and reconciliation. Run the focused E2E and unit suites, retaining only the expected new failures as RED evidence.

## Work package 2: Introduce the unified validation disposition and guarded acceptance core

<!-- comet-task-ref:ab441f6d-96e8-4eb6-94d8-0bf4a3a8474c -->
<!-- comet-task-ref:d7cda0b9-7959-4739-a422-e8d432c3bd3f -->
<!-- comet-task-ref:02ecb5ed-c02b-40fe-9e64-747ee14673df -->
<!-- comet-task-ref:23e3a1ff-fffb-49bd-a80e-19bd7ddf1dd9 -->
<!-- comet-task-ref:10b26d88-387a-4408-85ce-258ef456698a -->
<!-- comet-task-ref:b903de32-95dd-499e-962a-d4cff603d0f9 -->

Define a bounded domain protocol for `accepted`, `correctable-rejection` and `processing-error`. A validation record binds validator/profile identity, candidate digest, stable input digests and bounded findings; free text remains diagnostic and cannot decide state.

Create an exhaustive Build Work processor registry. Configure, Plan, Execute and Check must be explicit entries; an unregistered Build Work fails closed. The coordinator applies identity/protocol, schema, Work domain, lifecycle validator and transition-feasibility checks in that order and returns a typed disposition without inferring behavior from exception text.

Extend `WorkExecutionAuthority` with one guarded terminal acceptance operation. It rechecks Work, claim, attempt, checkEpoch, invocation, submission, candidate and stable validation digests before binding accepted submission, Host/Action Outcome, Receipt and validator fact. Input drift yields a typed stale result and no terminal facts.

Keep correction and processing states separate. Correctable rejection moves the same invocation to `awaiting-correction` and appends bounded history; processing failure retains the pending submission for Runtime recovery. Lock submission identity rules with tests: identical ID/content is idempotent, identical ID/different content conflicts, and a corrected candidate uses a new ID.

Turn only the new domain/authority tests green, then run existing submission and recovery suites before wiring Build Work behavior.

## Work package 3: Deliver the Configure vertical slice end to end

<!-- comet-task-ref:0a5a1863-1c9d-4bc3-afd4-e03157f1c3a1 -->
<!-- comet-task-ref:2d837b06-5f0c-4c0e-93a8-c546e8e11b52 -->
<!-- comet-task-ref:a4824a9d-3ab9-48a3-ac74-9091f20643d1 -->
<!-- comet-task-ref:85d81440-31df-4e60-aa6e-b1c27edb4b14 -->
<!-- comet-task-ref:3ca04124-3601-493f-8978-8dd5f3cdbc52 -->

Implement the Configure processor with complete candidate schema, Strategy identity/digest, repository set, workspace ownership and Binding construction checks. Start with structural and semantic RED cases, including the correct-kind/wrong-digest defect.

Route embedded and external Configure submissions through the coordinator. Delete `rejectInvalidConfigureResult()` and the Configure early `acceptOutcome()` path; `ManagedWorkExecutor` records the Host submission and execution facts but no longer decides terminal acceptance.

The bad Round 8 candidate must now return structured `awaiting-correction` while preserving all execution identities. Submit a corrected candidate with a new submission ID and prove it creates exactly one accepted Binding and one Plan Work.

Add interruption tests immediately before terminal commit and immediately after acceptance but before lifecycle observation. Cold recovery must process the original pending/accepted fact, never call the Host again and never create a replacement Work or attempt.

Run Configure domain tests, executor/authority tests, managed-change E2E and recovery tests. This package is the first complete production vertical slice; do not proceed to other Work kinds while its identity and restart invariants are red.

## Work package 4: Migrate Plan, Execute and Check and remove the parallel acceptance paths

<!-- comet-task-ref:36fc536f-cbb7-4fe2-afa6-784a48a4649a -->
<!-- comet-task-ref:604296b0-f4c2-45bb-8897-19cbaf5d4f6e -->
<!-- comet-task-ref:10d9ff1b-2853-4ce9-ba69-43fe8b5f1693 -->
<!-- comet-task-ref:0f8560bc-e38f-47e5-b680-920305c3f88a -->
<!-- comet-task-ref:346693b7-c742-455b-acd0-32fcd0a3b38a -->

Migrate Plan first: candidate normalization, Plan construction, Plan Evidence, task/write-scope/protected-branch/composition/Binding checks, lifecycle validator and transition feasibility all precede terminal acceptance. Delete the executor Plan delay branch and preserve existing rejection/correction identity.

Migrate Execute without collapsing its two-stage side-effect boundary. Validate package identity, Task revisions, Evidence, Plan invalidation and workspace checkpoint before terminal candidate acceptance; retain the current journal for Git/process progress and prove each interruption point is idempotent.

Migrate Check: validate completion/Evidence, current heads/checkpoint, Strategy, Binding and Plan before forming Verify input. Delete the Check delay branch.

Add a table-driven matrix across all four Work kinds for schema rejection, semantic rejection, lifecycle validator rejection, transition infeasibility and processing error. Finish by deleting every production condition that chooses immediate/delayed acceptance from Work names and make registry exhaustiveness the only extension mechanism.

Run Build protocol, protected-branch, package execution, Check/Verify input and managed execution suites after each migration instead of waiting for the final integration run.

## Work package 5: Unify public entry points, recovery and observability

<!-- comet-task-ref:d4cd08b5-1622-4d46-af30-d119df92d3d0 -->
<!-- comet-task-ref:8e1feeef-c6fb-434c-8351-4145260e64cb -->
<!-- comet-task-ref:e49aeb06-6b69-41a7-ab16-e9a2d0d0e9ce -->
<!-- comet-task-ref:b6480ce8-12b7-49fb-a14a-bae722d75d9b -->
<!-- comet-task-ref:83f2fd84-791f-404a-ae5d-48e55d753c5a -->

Make embedded execution, external `work-outcome` and known-candidate recovery call the same coordinator. Public CLI behavior may differ in presentation but must return the same disposition, bounded diagnostic and execution identity.

Protect reconciliation semantics: pending or rejected known candidates can never become `not-executed`; only an invocation with an actually unknown result uses reconciliation. Add restart and CLI tests for each entry point.

Project accepted, rejected, processing-error, validator and continuation facts into OpenTelemetry only after their persisted source fact exists. Assert once-only event ordering and bounded labels; candidate payloads, paths and diagnostic text never become Metric dimensions.

Run the same scenarios with a multi-repository Project Snapshot and verify Strategy, Binding, Plan and workspace checkpoint digests remain bound across restart. Update the formal Runtime/Host protocol documentation and the managed-execution report checker in the same package.

## Work package 6: Full verification, independent review and clean multi-repository replay

<!-- comet-task-ref:c351caf8-aefe-468a-8c3d-eeefd7e36e93 -->
<!-- comet-task-ref:2763104c-fc1d-4ee9-b831-8f54e69496f7 -->
<!-- comet-task-ref:657897f5-6ef0-47f0-9d71-764748fc6679 -->
<!-- comet-task-ref:4fa9a8d2-91fc-44cf-a0c9-a1de20ecb525 -->
<!-- comet-task-ref:ef8a4b65-0a61-47c4-8253-f17a83b3ed61 -->
<!-- comet-task-ref:2d22d4cc-6da9-45d6-9c03-127b3df9a852 -->

Run the focused authority/executor/recovery/managed-change/telemetry suite, then typecheck, lint, architecture and provenance checks. Resolve every regression at the package that introduced it; do not weaken tests or add compatibility aliases.

Run `npm run verify` and fixed-upstream drift checks. Reinspect Comet 0.5.1 `recordOutcomeInternal` and confirm the final Repoctopus ordering preserves the same identity/rejection invariant without importing its Runtime.

Perform the configured thorough review after implementation is stable. The reviewer must inspect terminal acceptance ordering, failure classification, Execute side-effect recovery, external/internal parity and telemetry cardinality. CRITICAL/IMPORTANT findings are fixed and affected checks rerun; an implementer self-review cannot satisfy the independent review requirement.

Finally create a new clean multi-repository acceptance Run and replay the Round 8 wrong-digest Configure candidate through correction and Archive. Save the Run/Work/submission/Evidence/phase telemetry in the formal verification report, confirm the old Run was untouched, and remove temporary logs and scratch artifacts.

## Failure handling and rollback

- A conflict between the current specification, approved Design, fixed Comet behavior or Run Store invariant stops Build and returns to Design; it is not resolved with a hidden compatibility branch.
- A correctable Host candidate remains on the same invocation and asks for a new submission ID. A transient Runtime/Provider failure retries processing the pending candidate. An unknown external result enters reconciliation and is never replayed automatically.
- If guarded acceptance discovers stable-input drift, discard the validation record and re-observe; never accept it against a newer checkpoint.
- If the final change regresses existing Build workflows, revert the complete implementation commit range. No schema migration or old-Run rewrite is part of this change, so rollback does not require data repair.
