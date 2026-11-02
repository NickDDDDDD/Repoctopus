---
change: fail-fast-verification-coverage
design-doc: openspec/changes/fail-fast-verification-coverage/design.md
base-ref: cd9722c71ebc2c69f3b8af6d667853db96bbeeb0
---
# Fail-fast verification coverage implementation plan

<!-- comet-task-authority: openspec/changes/fail-fast-verification-coverage/tasks.md -->

## Implementation constraints

- Keep `openspec/changes/fail-fast-verification-coverage/tasks.md` as the only task and completion authority; this plan contains no completion ledger.
- Preserve the Runtime-authoritative phase boundary: Hosts and Agents report outcomes, while the Runtime decides whether Design can advance.
- Perform coverage checks before approval-store writes, Build Work creation, Evidence Attempt creation, repository fingerprinting, or command execution.
- Reuse one deterministic coverage resolver for Design preflight and formal Verification Input generation.
- Use the approved `autonomous + tdd + thorough` strategy. Each behavior change starts with a failing regression and records the focused RED/GREEN command before its task is completed.
- Do not edit Runtime Store files, fabricate Evidence receipts, or introduce compatibility paths for the broken behavior.

## Work package 1: Detection produces a reviewable safe candidate

<!-- comet-task-ref:c120d0c8-62fe-4337-afcd-91aa4fe669ab -->

Start with a failing assertion in `test/project-detection.test.ts` that every detected required command node declares `covers: ['*']` and that the draft contains an `acceptance-coverage` unresolved item explaining that the selector may be narrowed before approval. Extend `DetectionUnresolvedItem` in `domains/project-configuration/detection.ts`, then update `platform/project-configuration/detect.ts` to add the selector and source-aware finding without writing formal configuration or business repositories.

Focused verification: run the project-detection test and confirm existing source, confidence, Store binding, and read-only assertions remain green.

## Work package 2: Onboarding rejects an unusable default Verify profile

<!-- comet-task-ref:f653c208-76d0-428d-8193-b15d861c760b -->

Add RED cases in `test/project-onboarding.test.ts` for a missing default `verify` Profile, all-empty coverage, and optional-only coverage. Add a domain-level readiness assertion in `domains/project-configuration/onboarding.ts` and invoke it from `createProjectConfigurationDecision()` after canonical parsing but before snapshot creation. Permit required coverage nodes to coexist with uncovered service or prerequisite nodes, and do not classify unrelated non-default Profiles as Change Verify Profiles.

Focused verification: run onboarding and project-configuration tests. Confirm rejected candidates create neither an approval request nor `repoctopus.yaml`.

## Work package 3: Extract the single coverage authority

<!-- comet-task-ref:dbae7715-35c0-4eb9-a55b-0104144dc19d -->

Move the private resolver out of `domains/change-lifecycle/verification-input.ts` into a dedicated pure domain module. Define its own stable result type for sorted Acceptance criteria, Acceptance Set hash, and node mapping. Add focused unit tests covering wildcard, Task, Requirement, exact Acceptance ID, duplicate and unknown selectors, duplicate Acceptance identities, uncovered criteria, and optional-only matches. Make `createVerificationInput()` call this exported authority without changing its repository, Skill, fingerprint, or digest checks.

Focused verification: run the new resolver tests and `test/verification-input.test.ts`; compare identical inputs to prove deterministic mappings and hashes.

## Work package 4: Place preflight before the Design approval side effect

<!-- comet-task-ref:bd0fae33-6f2e-4af8-8cf6-7cd5549ecfbd -->

Add a read-only Evidence Coordinator compile operation that loads Effective Project Config and compiles the Evidence Profile DAG without computing repository fingerprints. Extend `SpecificationPlanning.assess()` with a typed pre-approval preflight boundary executed after Planning Snapshot construction and before `requestSpecificationApproval()` or approval-store commit. After the callback succeeds, reread the Planning Manifest and require the same semantic digest; return a blocked assessment on coverage failure or drift.

In `services/workflow-runs.ts`, provide this callback only for the Design gate. Load the actual Run `verificationProfileId`, the current Task set, and the compiled profile, call the shared coverage resolver, and append its stable digest to Design Gate evidence. Keep Open approval behavior unchanged. A failure must retain the Design checkpoint and produce a retryable diagnostic without validating the Design Work, creating a Human Decision, binding Build Skills, or creating Build Work.

Focused verification: add service tests for callback ordering, approval-store non-invocation, manifest drift, successful evidence propagation, and retry. Run specification-planning, workflow-run, and lifecycle transition tests.

## Work package 5: Prove the real Runtime boundary

<!-- comet-task-ref:3fa8819f-ba2d-44fc-9ab5-60eab0e9779f -->

Extend the managed Change execution E2E with an invalid Profile whose nodes have empty or optional-only coverage. Drive the real public Runtime through Open and Design and assert it stops before the Design Human Decision and Build Configure Work. Assert no Evidence Attempt, command execution, repository fingerprint, Task completion, or Store edit occurred. Correct the shared configuration through the normal project surface and prove the same Run can reobserve the Design checkpoint. Keep a valid wildcard path that advances at least to Build Configure.

Focused verification: run the managed Change execution E2E and the production CLI multi-repository fixture. If the recovery assertion exposes a state-machine defect rather than a test-fixture issue, stop and revise Design instead of adding a bypass.

## Work package 6: Document the operator contract

<!-- comet-task-ref:dde9bfba-dd86-406c-b77f-8a0ce66d2aba -->

Update `docs/project-onboarding.md` to describe generated `*` coverage as a conservative candidate requiring review, show how teams narrow it with `task:`, `requirement:`, or exact Acceptance selectors, and explain the default `verify` Profile readiness rule. Update `docs/evidence.md` to document the Design preflight boundary and recovery by editing shared configuration and retrying the same Run. Explicitly prohibit hand-editing Runtime Store or treating optional evidence as a gate.

Focused verification: run documentation link/schema checks and inspect examples against the configuration parser.

## Work package 7: Integrated verification and cleanup

<!-- comet-task-ref:fcc4b227-2a35-473e-8e0e-f1381cb73bdc -->

Run all focused tests first, then the production CLI multi-repository initialization reproduction, `npm run verify`, package E2E, tracer E2E, strict OpenSpec validation, and Comet 0.5.1 Build/Verify guards. Perform thorough review over the complete diff, resolve all critical and important findings, and rerun affected checks. Remove temporary repositories, logs, generated scratch output, and diagnostic files while retaining committed workflow evidence.

If any full check fails, preserve the failing command and root-cause evidence, repair the responsible work package, and rerun the smallest affected set before repeating the integrated gate.
