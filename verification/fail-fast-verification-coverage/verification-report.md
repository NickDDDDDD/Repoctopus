# Fail-fast Verification Coverage Verification Report

## Reproducible subject

- Change: `fail-fast-verification-coverage`
- Tested implementation commit: `0513b3c79c70be9bac82c47147e3225084f204cb`
- Package: `repoctopus@0.1.0`
- Package files: `448`
- Package content bytes: `5276590`
- Package content SHA-256: `794af1393d836c4e2a001bad41332521f87eecb58dad14945a84499ef4f7d952`
- Controller: `@rpamis/comet@0.5.1`
- Platform: Windows x64
- Node.js: `24.21.0`

The tested commit is the packaged-product and Runtime-regression boundary. Later commits may contain only OpenSpec state, this verification evidence, or Comet lifecycle evidence. `check:managed-execution-report` independently rebuilds the npm archive and rejects any later product or checker change.

## Invariants proved

1. Project detection emits required command candidates with explicit `covers: ['*']` and an `acceptance-coverage` review finding; detection remains read-only.
2. Project approval rejects a missing default `verify` Profile, empty required coverage, and optional-only coverage before writing shared configuration. Uncovered prerequisite nodes may coexist with an actually covering required node.
3. Design preflight and formal Verification Input use one deterministic resolver for wildcard, Task, Requirement, and exact Acceptance selectors. Duplicate, unknown, uncovered, and optional-only mappings fail closed.
4. Design preflight runs after the immutable Planning Snapshot and before approval persistence. It rereads the Planning Manifest and rejects semantic drift before creating a Human Decision.
5. Preflight compiles the selected Evidence Profile without repository fingerprint collection, Evidence Attempt creation, node execution, or Build Work creation.
6. A failed coverage preflight leaves the same Run in Design, keeps every Task pending with no completion claim, creates no Design approval and no Evidence run, and can be retried after the configuration is corrected.
7. The valid path still advances through the real public Runtime from Open to Design, Build, Verify, and Archive.

## Commands and results

```text
npx vitest run test/project-detection.test.ts test/project-onboarding.test.ts \
  test/project-configuration.test.ts test/acceptance-coverage.test.ts \
  test/verification-input.test.ts test/specification-planning-service.test.ts \
  test/e2e/project-onboarding-flow.e2e.test.ts
  7 test files passed; 33 tests passed

npx vitest run test/managed-change-execution.e2e.test.ts -t "one business rep…"
  1 test passed; 3 skipped
  invalid coverage stopped before approval, Build, Task completion, fingerprinting,
  Evidence Attempt, and command execution; the corrected same Run completed Archive

npm run verify
  TypeScript, Desktop TypeScript, ESLint, CLI/Desktop builds passed
  175 test files passed; 798 tests passed; 2 skipped
  generated output, brand, architecture, provenance and Dashboard salvage passed
  strict OpenSpec validation passed 18 items; 0 failed
  the final report freshness gate correctly rejected the prior product boundary

npm run test:package-e2e
  1 test file passed; 1 test passed

npm run test:tracer-e2e
  1 test file passed; 1 test passed
```

The first complete suite exposed the expected composition identity change from the new read-only Evidence Coordinator operation and one transient Desktop activation target miss. The identity snapshot was updated; the Desktop case passed independently and the next complete 800-test run passed. A final `npm run verify` must reproduce this report's normalized package identity before Verify can complete.

## Review and architecture fit

- The Runtime remains the phase authority. The Host and Agent cannot choose the next phase or bypass coverage.
- The preflight boundary is pure with respect to execution: it loads Tasks and effective configuration, compiles the Profile DAG, resolves coverage, and returns a digest.
- Planning identity is checked again after the callback, matching Comet's fail-closed preflight and input-revalidation pattern without importing Comet's storage model.
- No second task ledger, approval authority, verification state, compatibility reader, daemon, webhook, or Store repair path was introduced.
- `*` is documented as a conservative generated candidate, not a universal best practice; teams should narrow it to the scope actually proved by a check.

## Cleanup

- The temporary npm archive and its package directory were deleted after computing the normalized content identity.
- Test repositories and OpenSpec registrations are owned by fixture cleanup and were removed after each run.
- No Runtime Store, approval, Task checkbox, checkpoint, or Evidence record was edited to bypass a gate.
- No temporary debug logs or scratch source files remain in the worktree.

## Verdict

The implementation fails fast at the Design boundary, preserves the valid lifecycle, uses one coverage authority, and has passed focused domain, service, production CLI, public Runtime, package, tracer, architecture, provenance, and strict specification checks. It is ready for the final reproducibility gate and Comet Build/Verify guards.
