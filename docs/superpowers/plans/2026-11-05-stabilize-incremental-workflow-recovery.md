---
change: stabilize-incremental-workflow-recovery
design-doc: openspec/changes/stabilize-incremental-workflow-recovery/design.md
base-ref: 22195e9eaf05579ceb5d5ad67695246a372225c2
archived-with: 2026-11-05-stabilize-incremental-workflow-recovery
---

# Stabilize incremental workflow recovery implementation plan

<!-- comet-task-authority: openspec/changes/stabilize-incremental-workflow-recovery/tasks.md -->

## Implementation constraints

- `openspec/changes/stabilize-incremental-workflow-recovery/tasks.md` remains the only completion authority. This plan groups stable task IDs into executable packages and does not create another checklist.
- Use the approved `autonomous + tdd + thorough` configuration. Every behavior slice begins with an assertion that fails for the intended reason, then receives the smallest domain-safe implementation and affected regression run.
- Fixed reference is Comet 0.5.1 commit `35c9860b77b42bafa0c2d80d8d695889f888a924` under MIT. Reuse its ordered authority inspection, explicit revision command, CAS and evidence invalidation semantics; do not import or package Comet Runtime/SDK.
- Preserve Repoctopus architecture: OpenSpec is specification authority, Runtime chooses actions, Host reports bounded facts, Work is the execution unit, Cordis composes providers, and Project Snapshot spans the coordination repository plus business repositories.
- Recovery order is planning semantics, Build Plan, current Work, then Evidence. One observation yields one highest affected decision; lower layers do not issue a second punishment for the same cause.
- Runtime decisions use stable identity plus expected run revision, checkEpoch and observation identity. Duplicate or concurrent application converges to one checkpoint; it never rewrites historical claim, packet, invocation, submission, rejection, outcome or approval facts.
- Planning artifacts in a registered Specification Authority path are `planning-semantic` inputs even when Git tracked. Ordinary tracked product paths remain product inputs; only policy-matched external local execution files are control-plane inputs.
- Task checkbox, ordinary commit OID and publication provenance do not invalidate planning semantics or Evidence unless a declared consumer explicitly binds them.
- Delete obsolete recovery paths instead of keeping compatibility aliases. This project is pre-1.0; an old incompatible active Run must fail explicitly rather than entering a dual state machine.
- Each coherent commit is pushed immediately. Do not open a PR until the complete change passes Verify and Archive.

## Work package 1: Freeze provenance and recovery contracts with RED tests

<!-- comet-task-ref:a4fd5783-13b7-434f-b0f9-0d71249ec402 -->
<!-- comet-task-ref:855f7952-223f-4eb0-8295-4618114fe550 -->

Extend the existing upstream provenance registry and `scripts/check-provenance.mjs` fixtures with the fixed Comet commit, MIT boundary and exact revision-readiness/revision-application/evidence-invalidation source files. Add a negative dependency/package assertion proving production manifests and emitted bundles contain no Comet SDK or Runtime import.

Add table-driven RED contracts in a focused recovery-domain test file. Express simultaneous and isolated planning, plan, work and evidence drift and assert the four core results: `revise-design`, `revise-plan`, `continue-build`, and `invalidate-evidence`. Repeat equivalent observations in different input orders and assert one stable decision identity.

Run the new contract and provenance tests before production edits. The classifier tests must fail because the domain contract does not exist yet; existing provenance checks remain green.

## Work package 2: Build the ordered recovery domain and atomic decision application

<!-- comet-task-ref:e7054d0d-52d7-4dd5-a646-ed0efaa177fe -->
<!-- comet-task-ref:ffe993f0-b318-40c2-b970-97dca399e9b7 -->
<!-- comet-task-ref:749e689c-ea08-4d4b-b171-ce48277a7e38 -->
<!-- comet-task-ref:8101fce2-f5f2-445a-a904-475fdd912bf1 -->

Introduce immutable Recovery Observation, authority-specific diff, Recovery Decision and invalidation-set contracts under the Runtime/change-lifecycle domain boundary. Their parsers accept bounded facts and references only; payloads containing a Host-selected phase, transition or recovery action fail schema validation.

Implement separate Requirements/Design, Plan, current Work and Evidence inspectors plus a thin coordinator with fixed short-circuit order. Avoid a giant union-driven service classifier: each inspector owns its evidence contract, while the coordinator only normalizes ordering and selects the first invalid authority.

Extend the Runtime identity graph with explicit planning-semantic, design approval, build strategy, execution binding, plan, work input, completion, evidence dependency and publication provenance nodes. Compute sorted preserved/invalidated closures using downstream edges only. Add property tests for input permutation, idempotence and non-propagation from checkbox/publication-only facts.

Add an atomic application port that accepts expected run revision, checkEpoch, observation identity and decision identity. Under the Store transition lock, re-read the checkpoint, reject stale inputs and materialize the new checkpoint once. Concurrency tests must show two runners converge to one decision/checkpoint or one receives a typed revision conflict.

Turn the package RED suite green, then run `test/runtime-invalidation-scope.test.ts`, `test/runtime-stability.test.ts` and change-lifecycle domain regressions.

## Work package 3: Replace action-shaped findings and wire minimal recovery checkpoints

<!-- comet-task-ref:0af000c7-725e-4af6-a42b-64d006f51c59 -->
<!-- comet-task-ref:8284985e-4ff2-47e1-bc0f-d54ec1f13df5 -->
<!-- comet-task-ref:320bf9ce-6559-41d2-9de5-3c77bcfdb786 -->
<!-- comet-task-ref:116ced0e-8601-437c-b7c4-6df4f00403ba -->
<!-- comet-task-ref:e6a5e937-ba0f-4a43-a5b4-ea6fc65d7eac -->
<!-- comet-task-ref:e35dd6de-5101-4dd6-968e-94c84621368c -->
<!-- comet-task-ref:e594e6ac-37d7-4f37-9fed-92b1e9e3440f -->

First extend `test/work-execution-findings.test.ts`, `test/change-lifecycle-domain.test.ts` and WorkflowRuns service tests. Assert old `design_assumption_invalid`, `planning_semantics_changed` and `build.design-revision-*` inputs are rejected, bounded Requirement/Task/Package/Evidence references are verified, and free-text summaries do not influence decision identity.

Replace action-shaped findings with bounded implementation failure, authority-conflict claim, plan constraint, evidence mismatch, infrastructure unavailable and external-result-unknown facts. Normalize only bounded codes and validated references; keep arbitrary summaries diagnostic-only.

Implement `continue-build` so safe retry retains the current plan and execution lineage, while an unknown external effect enters existing reconciliation with its original invocation. Restart tests must preserve all historical claim, packet, invocation, submission, rejection and outcome facts and must never replay an unknown candidate.

Remove obsolete Build-to-Design wait, approval/rejection transitions, observations and telemetry enums from `domains/change-lifecycle/definition.ts`, `transition.ts` and their consumers. Add reachability tests proving the new decisions remain pullable through public Runtime continuation.

Materialize `revise-design`, `revise-plan`, `continue-build` and `invalidate-evidence` as explicit atomic decision applications. `revise-design` creates the Design checkpoint once; `revise-plan` stays in Build and preserves unaffected completions; `continue-build` retains plan/work identity; evidence invalidation returns to the nearest valid evidence producer.

Refactor `services/workflow-runs.ts` to collect facts, call the ordered coordinator and apply its decision through CAS at Plan, Execute, Check, Verify and closing observations. The Service must not branch on a finding name to select a phase. Run domain, WorkflowRuns, restart and continuation suites after GREEN.

## Work package 4: Reject infeasible Plans and invalid specification mappings early

<!-- comet-task-ref:fa22cb21-6026-47cf-b9a7-43e7a8068bef -->
<!-- comet-task-ref:6fedaa33-c7c1-4e36-8476-cd1b1244f771 -->
<!-- comet-task-ref:9b6f3284-ddc7-4e9d-8fdd-6300ec67c717 -->
<!-- comet-task-ref:1e5dead0-2795-4512-9b9d-8302a7d97132 -->
<!-- comet-task-ref:dd268ca7-883c-415c-9ea5-59d2d3b3203f -->
<!-- comet-task-ref:c524e3c7-c2a9-44f7-b5d9-467f31922879 -->
<!-- comet-task-ref:4c099978-2eba-4ab4-9cf2-976a0031c712 -->

Add RED cases to `test/build-protocol-domain.test.ts` for packages missing their own Outcome/Validator evidence, fake completion split across packages, and TDD RED/implementation/GREEN/regression steps split across independently completable packages. Add authorization-envelope cases where ordering or equivalent command representation stays inside approval while repository, write scope, risk or side-effect expansion requires a decision.

Extend the Plan validator so every Work Package is independently completable. In TDD mode, the same behavior slice contains RED, implementation, GREEN and relevant regression closure; direct mode still requires implementation and regression closure but no synthetic RED. Return structured Plan facts that select `revise-plan`, not Design.

Add RED parser cases for comma, Chinese comma, semicolon and Chinese semicolon Requirement metadata, plus empty or ambiguous tokens. Make the Specification Provider resolve Task mappings against stable Requirement identities from current main specs and deltas; Build consumes the structured result and never reparses prose.

Extract a pure closure analyzer for capability Purpose, delta operations and retirement relations. Reuse it in Open/Design strict preflight and Archive candidate validation; later stages may re-observe identity and checkout facts but cannot discover the same deterministic Purpose error for the first time.

Run Build Protocol and specification-planning/provider suites, OpenSpec strict validation and focused mutation cases. Any new planning decision must remain within the approved authorization envelope or stop for a real decision.

## Work package 5: Persist explicit Evidence dependencies and invalidate only their graph

<!-- comet-task-ref:7627945a-6e2a-49ee-8cea-2343e79c2635 -->
<!-- comet-task-ref:60de5dcb-261d-442a-b6f5-eb2bcd5a8696 -->
<!-- comet-task-ref:b4deb521-4982-4141-b7e3-c3cb74b670ce -->

Start with RED fingerprint and persistence tests for product content, official planning semantics, external control-plane manifest, optional Git identity and publication provenance. Include the approved tracked-input clarification: registered planning artifacts remain planning-semantic, ordinary tracked product paths remain product, and local external inputs require an exact policy match.

Extend Receipt, Bundle, Gate, Build Check and Verification Input persistence with normalized dependency sets and identities. Round-trip tests must compute the same identity after restart; unknown or unclassifiable inputs fail closed without reading outside the repository boundary.

Implement graph-based `invalidate-evidence` from changed declared inputs to dependent Receipt/Bundle/Gate nodes. Preserve unrelated evidence. Treat provider/environment unavailability as blocked/retry on the current check, never as plan or design drift.

Run repository-input, evidence, invalidation-scope, persistence/restart and verification-input suites. Include mutations for content, policy, symlink/type race, checkbox-only update, ordinary coordination commit and an explicitly Git-bound check.

## Work package 6: Make recovery observable and deterministically replayable

<!-- comet-task-ref:9af6511c-75b0-4e0f-99aa-33ede8858c76 -->
<!-- comet-task-ref:7b49f00d-ae7c-4beb-9ede-bc9ea2b18e7b -->
<!-- comet-task-ref:7fc72b11-661d-44d5-ac6b-e5ab9b9f9d4e -->

Add RED trajectory schema cases for recovery observed, classified, applied and evidence invalidated. Events carry stable decision identity, source action, authority layer, bounded reason, preserved/invalidated counts and outcome; they do not carry raw paths, Requirement text, commit, digest or arbitrary finding summaries as metric attributes.

Map the bounded facts into existing OTLP spans/metrics and update `docs/telemetry.md` plus generated telemetry reference. Privacy/cardinality tests must prove repeat application does not emit a second logical decision and Dashboard correlation remains on existing change/run linkage.

Create one sanitized multi-repository trajectory fixture covering: invalid TDD split, wrong test slice, Task checkbox closeout, genuine planning-semantic change, isolated Evidence drift, provider unavailable and duplicate recovery submission. Deterministic replay must yield one `revise-plan` for plan faults, no rollback for checkbox closeout, one `revise-design` for real planning change, and only targeted evidence invalidation.

Run trajectory, telemetry mapping, cardinality/privacy and replay suites before integrating the fixture with public Runtime APIs.

## Work package 7: Exercise public Runtime, CLI and a real simulated multi-repository change

<!-- comet-task-ref:0dc08d73-6a68-487e-9b58-7985d04f1500 -->
<!-- comet-task-ref:56292f05-a314-41e2-8893-466f6f368330 -->

Add Runtime Service and CLI integration coverage for cold resume, repeated pull, process interruption, stale expected revision and forged phase/action/candidate requests. Runner tests execute only the exact argv/cwd/env returned by Runtime; hand-written equivalent commands cannot manufacture a valid receipt or transition.

Initialize a fresh acceptance coordination repository and multiple small business repositories through the public Repoctopus CLI. Run one deliberately small change across Open, Design, Build, Verify and Archive, then inject only the bounded recovery scenarios from the replay fixture. Do not reuse the removed legacy acceptance product.

Inspect authoritative Run, Work, Skill, Evidence, trajectory and OTLP projections after each scenario. Acceptance requires no unjustified Build-to-Design transition, no double rollback during close, preserved unaffected completions and an explanation for every recovery from both trajectory and telemetry.

Commit and push the acceptance fixture/evidence that is intentionally part of the regression suite; remove temporary repositories, local logs, package outputs and one-off diagnostic data.

## Work package 8: Thorough review, complete verification and cleanup

<!-- comet-task-ref:e45dcb55-677b-4280-b31a-8a9903a82ad2 -->

Use an independent reviewer for each high-risk integration tranche and one final integration review. Focus on authority-order inversion, Host-selected actions, stale-CAS acceptance, over-invalidation, lost execution history, TDD package loopholes, classification of official planning artifacts, hidden compatibility paths and high-cardinality telemetry. Resolve every CRITICAL/IMPORTANT finding with a focused failing test before correction.

Run focused suites throughout, then execute `npm run typecheck`, `npm run typecheck:desktop`, `npm run lint`, `npm run check:generated`, `npm run check:architecture`, `npm run check:provenance`, `npm run spec:validate`, relevant package/E2E checks and finally `npm run verify`. Also search current production source, current specs and telemetry mappings for removed findings/transitions; historical archives and explicit migration-rejection fixtures are the only permitted occurrences.

Record exact verification commands and results in the formal Verify report, not implementation notes. Remove temporary test repositories, logs, generated troubleshooting registries and local package outputs while preserving formal evidence and Comet/OpenSpec artifacts.

If a real planning change produces more than one `revise-design`, a Plan-only fault leaves Build, a checkbox-only change invalidates planning, an unavailable provider causes Design/Build rollback, or duplicate application creates a second checkpoint, stop Build and revise the approved Design instead of adding a bypass.
