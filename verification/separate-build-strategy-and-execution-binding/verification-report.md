# Build Strategy and Execution Binding Verification Report

## Reproducible subject

- Change: `separate-build-strategy-and-execution-binding`
- Tested implementation commit: `5f382e0fc0750eb9311153bdc9b9e712496e2778`
- Package: `repoctopus@0.1.0`
- Package bytes: `1040179`
- Package SHA-256: `a29eee9e0e6b990f22d158dc935d6287cbca7cd4bb81e210d84c08337c084f4c`
- Controller: `@rpamis/comet@0.5.1`
- Platform: Windows x64
- Node.js: `24.21.0`
- Lifecycle definition: `repoctopus-change@4.7.0`
- Lifecycle definition digest: `sha256:8d2d951299cd9dbdc91bb7aaca960501311c1aed45123512c83dade34d19d2d1`

The tested implementation commit is the packaged-product boundary. Later commits may contain only OpenSpec state or verification evidence. `check:managed-execution-report` rejects a later packaged-product change and independently reproduces the npm package checksum.

## Authority and identity invariants proved

1. `BuildStrategy` contains only stable human choices: execution mode, TDD mode, standard review, and isolation intent. Runner identity, capability observations, checkout paths, branches, worktrees, and repository HEADs cannot change its semantic identity.
2. `ExecutionBinding` is the Runtime-owned portable observation of Host and repository execution facts. Absolute paths remain behind a local overlay reference and are not persisted in its portable value.
3. Design approval binds the exact Strategy digest. Configure observes and validates the current Binding without adding a routine Human Decision.
4. A Host, capability, checkout, branch, worktree, or HEAD change revalidates only the Binding and its typed descendants. It does not invalidate a compatible Strategy decision.
5. Build Plan identity depends on both Strategy and Binding. Plan Evidence completely reconstructs the canonical Plan from authoritative Tasks and rejects missing Tasks, acceptance references, repository scope, write scope, dependency edges, report ownership, Host compatibility, composition, Strategy, or Binding facts.
6. Pre-dispatch execution re-observes checkout and HEAD facts. A stale Work is replaced before Host invocation, so no package can execute against an obsolete Binding.
7. High-risk Plan approval uses a semantic risk digest that excludes machine Binding state. Compatible Binding revalidation reuses the decision; a changed execution graph or risk semantics requires a new deterministic decision.
8. Human Decision identity is derived from Run, decision kind, and semantic proposal digest. Superseded proposals remain in history and cannot authorize a later proposal.
9. External Runner claims must match the current Execution Binding Host. Configure is the only Build Action allowed to establish or replace that binding.
10. Production code has no writable `BuildConfiguration`, `configurationDecision`, or `build.configuration.*` lifecycle path. An architecture regression test enforces this boundary.

## Managed lifecycle evidence

`test/managed-change-execution.e2e.test.ts` exercises four fresh production-composition lifecycles:

- autonomous execution with one business repository;
- autonomous execution with multiple business repositories;
- subagent-driven execution with multiple business repositories;
- compatible Execution Binding drift followed by automatic revalidation and continuation.

The drift scenario changes a repository HEAD after Plan approval. Runtime selects Configure, creates a new Binding, preserves the Strategy and compatible high-risk approval, then rebuilds the Plan against the new Binding before Execute. The harness asserts no stale package Work is invoked and no duplicate Human Decision is created.

The packaged CLI scenarios additionally prove that direct specification approval creates and binds a deterministic Build Strategy, that the Change Run entry point uses definition `4.7.0`, and that Desktop activation remains available after the production build.

## Verification commands and results

Executed on Windows with Node.js `24.21.0`:

```text
npm run verify
  TypeScript, Desktop TypeScript, ESLint, CLI build, and Desktop build passed
  158 test files passed
  708 tests passed; 2 skipped
  generated output, public naming, architecture, provenance, and Dashboard salvage passed
  OpenSpec strict validation passed 18 items; 0 failed
  the previous report was correctly rejected only because it did not cover this package boundary

npx vitest run test/managed-change-execution.e2e.test.ts
  1 test file passed; 4 tests passed
  autonomous, multi-repository, subagent-driven, and Binding-drift lifecycles completed

npx vitest run test/e2e/specification-approval-cli.e2e.test.ts test/e2e/change-run-cli.e2e.test.ts test/e2e/desktop-run-activation.e2e.test.ts
  3 test files passed; 4 tests passed

npm run spec:validate
  18 strict OpenSpec items passed; 0 failed

npm run check:architecture
  276 production sources and 21 capability owners verified

npm run check:provenance
  20 Comet-derived files, 60 immutable Cordis files, 33 Matt Skill files,
  8 fixed DSH packages, and 5 DSH Desktop references verified
```

## Telemetry and Desktop evidence

Trajectory and OTLP distinguish stable Strategy selection from Binding creation and revalidation. They also expose bounded Build Action, decision, invalidation reason, phase, outcome, execution mode, TDD mode, review mode, and isolation dimensions. Run, Work, Strategy, Binding, repository, Task, package, digest, path, and free-form diagnostic identities remain Trace/Event values rather than metric labels.

The Desktop projection renders Strategy identity and choices separately from Binding identity, revision, Host, and repository state. Binding drift is visible as a revalidation event rather than a misleading Strategy change or repeated approval.

The packaged Comet Classic handoff at `docs/superpowers/reports/separate-build-strategy-and-execution-binding.md` binds the independent Verify review to this report without creating another specification or task authority. Because that handoff is part of the npm package, the package boundary and checksum above were recomputed after it was committed.

## Cleanup

- The temporary npm package archive and its directory were removed after hashing.
- No Runtime Store, approval record, or checkpoint was edited to bypass a lifecycle gate.
- No debug log, temporary receiver, test Workspace, or package payload remains in the working tree.

## Verdict

The packaged implementation cleanly separates stable human Build intent from volatile execution observations. Runtime remains pull-based, authoritative, Host-mediated, multi-repository aware, and fail-closed at every binding and dispatch boundary. Compatible environment drift converges automatically without approval churn, while semantic Strategy or Plan risk changes still require an explicit deterministic Human Decision.
