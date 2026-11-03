---
change: recover-protected-branch-rebinding
design-doc: openspec/changes/recover-protected-branch-rebinding/design.md
base-ref: d29da01e015a6a2d59768269a96615509aeb879d
---

# Recover protected branch rebinding implementation plan

<!-- comet-task-authority: openspec/changes/recover-protected-branch-rebinding/tasks.md -->

## Implementation constraints

- Keep `openspec/changes/recover-protected-branch-rebinding/tasks.md` as the only completion authority. This plan maps executable packages to stable task IDs; it does not create a second task list.
- Use the approved `autonomous + tdd + thorough` configuration. Every behavior change starts with a focused failing assertion, then the smallest domain/application implementation, then affected regressions.
- Preserve Runtime authority: the Host calls `next` or `resume`, Runtime classifies evidence and chooses `build.configure`; Agent/Runner cannot set phase, clear reconciliation or select a later Action.
- Authorization must be derived from the rejected `build-plan-candidate`, protected-branch findings, exact write scopes, old Binding/policy and observed snapshot diff. Never parse diagnostic text or trust branch naming conventions.
- Runtime remains read-only toward Git branch/worktree creation and publication. Production code observes and validates; tests and the external Runner perform Git side effects.
- Unknown or mixed branch/path/remote/topology/repository/worktree/Host/capability drift remains fail closed. Do not weaken generic reconciliation or protected-branch validation to make recovery pass.
- Reuse one classifier and one managed lifecycle transition from both `next` and `resume`. Do not duplicate recovery rules or add a second state machine.
- Do not add pre-release compatibility reads, Store edits, snapshot forgery, fallback inference or a second Change Run.

## Work package 1: Freeze the real resume failure with RED tests

<!-- comet-task-ref:55a7c1ec-4856-458a-8496-2313fcd5a4d9 -->
<!-- comet-task-ref:26bfacd4-7a32-469a-abac-c0ce4a20f491 -->
<!-- comet-task-ref:d0ac9b0e-9f86-4ef0-bc57-8501382a9d70 -->

Extend `test/managed-change-execution.e2e.test.ts` from its existing protected-write Plan rejection. After the Runner creates and pushes branches only for the protected write repositories, close and rebuild the application composition and call the production `run.resume` route rather than `next`. Freeze the current failure: generic project reconciliation sets `reconciliationRequired` and does not create `build.configure`.

Add a second fixture that performs the old failing resume once, preserves its branch-only reconciliation trajectory, then resumes again with the same current snapshot. Add a table-driven negative matrix for unrelated repository branch drift, checkout path, remote identity, topology/membership, detached/unpublished branch, worktree ownership and Host/capability changes. Assert structured codes and lifecycle facts, not human messages.

Focused RED evidence: run the protected-write E2E case and runtime resume tests before production edits. Confirm the exact correction and poisoned-state cases fail, while every unknown-drift negative already remains blocked.

## Work package 2: Model a narrow authorized rebind classification

<!-- comet-task-ref:551566e4-bc42-4e6d-b603-309cebea481d -->
<!-- comet-task-ref:d2b91160-d8da-457a-aeb8-d4868217437c -->
<!-- comet-task-ref:48cda826-dc40-400c-86cf-02dcc514ddf1 -->

Introduce a pure project/runtime domain value for authorized protected-branch correction. It contains a stable authorization digest plus normalized evidence references; it is not a boolean and contains no local path in its portable semantic digest. Extend `domains/project/snapshot.ts` and `domains/project/types.ts` only where project-diff facts belong; keep lifecycle-specific evidence assembly outside the generic snapshot reconciler.

The classifier accepts only Build `build.plan` in `awaiting-correction`, a rejected candidate with protected findings, an existing Binding/policy, and branch-only changes within the rejected protected write-set. It proves current branches are attached, published and non-protected. Empty changes, extra repositories and every non-branch identity dimension return a structured non-authorization result.

Fix partial correction semantics in tests: corrected repositories are recognized as expected, unresolved protected write repositories retain no write authority, and both entrypoints return the same structured waiting/reconfigure result without creating Execute Work.

Focused GREEN evidence: domain tests cover full, partial, empty, extra and mixed diffs; digest tests prove determinism and local-path exclusion.

## Work package 3: Unify next and resume around one atomic transition

<!-- comet-task-ref:34fa7c09-6ce7-4e05-9287-928c0772528e -->
<!-- comet-task-ref:5a45aa37-3c45-432f-8527-5ad277254079 -->
<!-- comet-task-ref:ad3f80d2-d23b-448a-926c-86e0729865ca -->
<!-- comet-task-ref:24f580b5-7f31-42a1-a2b9-64eea6db1e47 -->

Extract the specialized predicate currently embedded near the Build Plan branch in `services/workflow-runs.ts` into one application-level recovery operation that assembles immutable lifecycle evidence and calls the pure classifier. Invoke it from both `next` and `resume` before generic reconciliation is finalized.

Add a typed authorized-reconciliation input to `domains/runtime/workflow-runs.ts` rather than faking equal snapshots. In one guarded commit, record the authorization fact, clear only a reconciliation projection with the same authorization digest, retain the rejected submission/outcome, advance the check epoch, apply the existing `build.binding-revalidation-required` lifecycle observation and create exactly one Configure checkpoint. Preserve Design approval, Build Strategy and OpenSpec Tasks.

If authorization fails, execute the existing generic `reconcileProjectSnapshots` and sticky fail-closed behavior unchanged. Remove the duplicate `next` condition after both paths consume the shared operation.

Focused verification: service and runtime-store tests prove same-Run recovery, trajectory causality, rejection history preservation and no direct Plan/Execute jump. Re-run the original next E2E to prove parity.

## Work package 4: Prove idempotency and safe observability

<!-- comet-task-ref:f555d22c-0902-477c-900f-06c64dc35a0d -->
<!-- comet-task-ref:a800b1d9-afe9-4836-aeea-30c1da1f066d -->
<!-- comet-task-ref:a983be7f-45f8-49a5-b145-a6cddb49dc2a -->

Derive the rebind event/checkpoint identity from Run, rejected Plan checkpoint, authorization digest and target epoch so replayed or concurrent resume observes the existing transition instead of creating another. Test sequential replay, application restart and guarded-write conflict behavior; do not use duplicate-key exception handling as the idempotency mechanism.

Project the authorized rebind into the existing trajectory/telemetry pipeline. Span/Event attributes may reference protected evidence under current redaction policy; Metric dimensions are limited enums such as entrypoint, classification, outcome and poison-recovery. Repository IDs, branch names, paths, remotes, Run IDs and digests must not enter Metric labels.

Focused verification: `test/telemetry-mapping.test.ts`, stability/observation-envelope tests and cardinality/sensitive-value assertions pass, and repeated resume emits one successful transition plus optional idempotent observations.

## Work package 5: Recover and continue the preserved multi-repository Run

<!-- comet-task-ref:b8d7524d-4025-4758-b0f2-e9023663153a -->
<!-- comet-task-ref:a0737be6-885d-401f-8b81-b27c0c377626 -->
<!-- comet-task-ref:7743b0fd-80dd-49ff-bfd4-29c8fa181cdf -->

Build/package the corrected product and use it against the preserved `add-compact-task-status-v2` acceptance Run. The three writable repositories already have published source branches; the read-only backend remains on protected `main`. Call normal `run resume` without editing Store or creating another Run.

Prove the matching poison is cleared, exactly one `build.configure` Work is dispatched, Configure accepts a new Binding revision, and a newly submitted Plan references that revision while the old Plan checkpoint remains rejected history. Continue the small acceptance Change through Verify/Archive when no independent defect blocks it; otherwise capture the new issue with a separate structured diagnostic and keep this Change scoped to the recovery blocker.

## Work package 6: Document, verify and clean

<!-- comet-task-ref:769a70b3-cd49-409f-9ccf-8dff5a447c87 -->
<!-- comet-task-ref:7550d8cd-94e0-49c6-8410-b97c2f9a7b5d -->
<!-- comet-task-ref:516b03b6-2a9f-4a2c-9964-9ba3be920e2a -->
<!-- comet-task-ref:5cad9452-0ead-4d67-9b1c-86a12df1c983 -->

Update Runtime recovery/self-hosting documentation with the boundary between authorized rebind and generic reconciliation, the Runner's Git responsibility, same-Run checkpoint recovery, and fail-closed examples. Record the Comet rebind/checkpoint principle and Repoctopus multi-repository adaptation in the existing upstream provenance location; do not introduce ADRs, implementation notes or a second specification authority.

Run focused domain/service/E2E/telemetry suites, strict OpenSpec, generated/architecture/provenance checks and complete `npm run verify`. Perform thorough review for authorization widening, duplicated transition logic, unsafe Metric labels, non-atomic poison clearing and Store mutation. Repair all important findings rather than weakening tests.

Remove the two interrupted temporary Comet clone directories and temporary test logs/scratch registries after verification. Preserve formal Comet/OpenSpec artifacts, the real acceptance Run, structured failure evidence and all public branches. Report exact cleanup and verification evidence.

If recovery accepts an unrelated identity change, produces duplicate Configure Work, loses rejected Plan history, or requires editing persisted state, stop Build and revise the approved Design instead of adding a bypass.
