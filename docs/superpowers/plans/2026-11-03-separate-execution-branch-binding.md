---
change: separate-execution-branch-binding
design-doc: openspec/changes/separate-execution-branch-binding/design.md
base-ref: 1e111d9b59e546630a253a2217629cf18647abcd
---

# Separate execution branch binding implementation plan

<!-- comet-task-authority: openspec/changes/separate-execution-branch-binding/tasks.md -->

## Implementation constraints

- Keep `openspec/changes/separate-execution-branch-binding/tasks.md` as the only task/completion authority; this plan only maps executable packages to stable task IDs.
- Use the approved `autonomous + tdd + thorough` configuration. Every behavior change starts with a focused failing assertion, then the smallest implementation, then affected regression tests.
- Keep `ExecutionWorkspaceIntent`, per-repository `ExecutionWorkspaceBinding`, `ChangeStartBinding`, and Delivery intent as separate domain identities. Do not add a generic branch identity framework.
- Runtime remains read-only toward Git branch/worktree creation. Tests and the external Runner prepare checkouts; production Runtime only observes, validates, freezes, and revalidates facts.
- Do not weaken protected-branch validation to make Open pass. Open does not know write scopes; Build Plan remains the authority for which repositories require non-protected source branches.
- Do not add schema-1 dual reads, fallback inference, direct Store edits, or compatibility aliases for `branch-mismatch`.
- Preserve the real failed acceptance Run as diagnostic evidence until the corrected packaged CLI either resumes it safely or classifies it as composition-incompatible.

## Work package 1: Freeze the semantic regression with RED tests

<!-- comet-task-ref:0b3d0cce-0d53-4cd5-9dc2-95bdc6e5ac79 -->
<!-- comet-task-ref:e7ea31c1-f725-433a-9380-c3c879b9c699 -->
<!-- comet-task-ref:c531183a-745a-44bf-9235-97df290273ec -->
<!-- comet-task-ref:e20b3e4b-cd33-443d-96ee-cbc7822d60bc -->
<!-- comet-task-ref:523450a3-835e-4941-8e25-f16e943104d0 -->

Add domain tests proving the new Intent contract has no delivery target branch, then add a five-repository Service fixture with the coordination repository on its Change branch, read-only repositories on `main`, and another repository on a differently named feature branch. Freeze negative topology, remote identity, detached branch and worktree ownership cases. Preserve the existing Plan safety matrix so a writable protected branch remains rejected while a read-only protected branch remains valid.

Focused RED evidence: run `test/execution-workspace.test.ts`, the Intent sections of `test/build-protocol-domain.test.ts`, and protected-branch Plan tests before implementation; verify failures identify the two shared-branch assertions rather than unrelated setup.

## Work package 2: Separate Intent, Binding, error, and telemetry identities

<!-- comet-task-ref:26c5a165-707b-4817-a306-3ac79b495e14 -->
<!-- comet-task-ref:6f7562b4-5652-4cd8-8291-d3972bd5bf41 -->
<!-- comet-task-ref:9c95df08-2be1-44c5-867d-2c89b4e34f65 -->
<!-- comet-task-ref:fd44d6cf-0bc1-42b0-a4f1-21e8ba32a0f2 -->

Upgrade `ExecutionWorkspaceIntent` to its new single schema and remove `targetBranch` from the type, constructor, canonical digest and callers. Delete the shared branch comparison from both `bindExecutionWorkspace()` and `createExecutionWorkspaceBinding()`. Retain repository sorting, topology/remote checks, current/worktree ownership checks, attached branch validation and all three Binding digests. Remove `branch-mismatch` from the stable binding error union and telemetry allowlist, then audit Runtime, CLI, dashboard, documentation and persisted projections for accidental workspace-intent target consumption while leaving every Delivery target use unchanged.

Focused GREEN evidence: run domain, Service, telemetry mapping, lifecycle transition and typecheck suites. Review the diff specifically for delivery `targetBranch` removals outside the workspace-intent boundary; any such removal is a scope error.

## Work package 3: Repair both Open decision paths and production acceptance

<!-- comet-task-ref:b1977633-d3d2-433f-8417-1cda68d527da -->
<!-- comet-task-ref:cb4496fb-84b2-4fe8-8b06-12e538a133ec -->
<!-- comet-task-ref:848ab558-b119-44f8-940b-d55222ef820a -->
<!-- comet-task-ref:292d5fee-e9c4-4e38-bc36-aef8fda4847f -->
<!-- comet-task-ref:9d14088e-b156-4da8-9be3-2f111e65120b -->

Refactor initial Open approval and workspace-intent revision to call one Intent constructor that receives only workspace/change/isolation. Keep bind-before-write ordering and prove a failed precondition changes neither lifecycle nor Specification approval. Extend a Windows production CLI E2E from real start binding through Open Work claim/outcome and trusted branch decision; assert the coordination source and delivery target stay different, business repository branches are independent, the Run enters Design, and retry is idempotent.

Focused verification: run the Service decision tests and the new package/CLI E2E in isolation, inspect lifecycle and Specification Store records, and prove the test fails when either shared-branch comparison is restored.

## Work package 4: Prove reconfiguration, document boundaries, and finish acceptance

<!-- comet-task-ref:17dacdf0-f711-434b-a59b-cbc2bca8e4aa -->
<!-- comet-task-ref:10382a35-d3ab-4bc3-bad9-02454fb45d99 -->
<!-- comet-task-ref:7fae3b5d-9230-42d1-8988-3e28be2d23a1 -->
<!-- comet-task-ref:5b9dc4f6-b939-47ca-a035-8d4438f8422c -->
<!-- comet-task-ref:1ee9c804-2040-4b1f-8318-4a0789ce1b86 -->

Add a Build recovery regression: a Plan finding identifies a writable repository on `main`, the Runner switches only that repository to a source branch, Binding revalidation invalidates the old Plan, and the unchanged Open isolation decision is not requested again. Update Runtime/self-hosting documentation with the four identity boundaries and the late write-scope rule. Run focused tests, strict OpenSpec, generated/architecture/provenance checks and complete `npm run verify`, then perform thorough diff review and repair all important findings.

Build and use the corrected product CLI against the preserved multi-repository acceptance fixture. Resume the original Run only if normal composition compatibility permits; otherwise keep its formal diagnostic and start the identical Change scenario in a fresh Run. Remove only temporary logs, isolated scratch registries and test outputs; retain formal Comet state, OpenSpec artifacts, production tests and acceptance Run evidence.

If production acceptance requires all repositories to share a branch, protected-branch checks stop working, or a fix requires editing persisted Run/Store state, stop Build and revise the approved Design instead of adding a bypass.
