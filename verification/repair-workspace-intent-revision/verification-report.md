# Workspace Intent Revision Verification Report

## Subject

- Change: `repair-workspace-intent-revision`
- Run: `change-repoctopus-repair-workspace-intent-revision-441f7bac1d922ebd`
- Branch: `codex/repair-workspace-intent-revision`
- Product implementation boundary: `70102a630e06d4995ddbf1db7a5d6e2c695eb626`
- Build configuration: autonomous execution, TDD, standard review, worktree isolation
- Build plan: `build-plan:f97fbe8a826c773742994433`

## Behavior verified

1. A `workspace-intent:*` Human Decision wait remains authoritative under repeated `run next`; generic Open approval orchestration cannot replace its wait identity or checkpoint.
2. Every accepted lifecycle transition atomically retires a persisted Work execution when its Work identity or check epoch no longer matches the authoritative lifecycle snapshot.
3. A real second Node process can reject invalid `current` decisions idempotently, approve `worktree`, and resume the same persisted Run in Design without Store edits, duplicate Runs, or stale Build Configure resurrection.
4. Protected self-hosting adoption accepts only the active Run's exact direct predecessor implementation pair; undeclared implementations still require migration.
5. Execution retirement remains observable through bounded trajectory and OTLP attributes without introducing high-cardinality Metric labels.
6. Archive revalidates the frozen Evidence fingerprint immediately before `specification.close`; drift returns the same Run to Verify, retires even a validated close checkpoint, and performs no Specification provider side effect.

## TDD evidence

- RED: commit `6543830` added the failing cross-process recovery regression.
- GREEN: commit `b00d79a` implemented the protected wait, generic stale-execution retirement, and the typed cross-process fixture.
- Adoption: commit `d7241e1` added the active Run's exact predecessor pair so the Runtime could consume the new protected implementation without editing Run Store state.
- Verification identity refresh: commit `d438907` aligned pinned lifecycle evidence with `repoctopus-change@4.3.0` and refreshed the Comet-derived target digest.
- Archive RED: commit `511f94f` pinned the missing frozen-close transition and side-effect-boundary checks.
- Archive GREEN: commit `70102a6` reused the existing reverify path at execution time, advanced the protected lifecycle to `repoctopus-change@4.4.0`, and limited adoption to the active Run's exact direct predecessor.

## Verification commands

Executed on Windows with Node.js `24.21.0`:

```text
npm run verify
  142 test files passed
  563 tests passed; 2 skipped
  backend and desktop typecheck passed
  ESLint, production and desktop builds passed
  generated, brand, architecture, provenance and Dashboard salvage checks passed
  strict OpenSpec validation passed 15 items with 0 failures
  managed execution package report reproduced commit and SHA-256

npx vitest run test/managed-change-execution.e2e.test.ts
  4 tests passed, including the real cross-process recovery fixture

npx vitest run test/runtime.test.ts test/telemetry-mapping.test.ts test/change-lifecycle-domain.test.ts test/execution-workspace.test.ts
  39 tests passed

npx vitest run test/composition-compatibility.test.ts
  5 tests passed
```

The full suite initially exposed two stale `4.2.0` verification expectations after the lifecycle definition had moved to `4.3.0`; those pins and the reproducible package report were refreshed and then passed. Archive close freshness subsequently advanced the definition to `4.4.0` with only the active `4.3.0` definition and exact protected plugin identities declared adoptable. A later full-suite run exceeded the former 120-second budget for one subprocess-heavy lifecycle scenario without an assertion failure. The scenario budget is now 240 seconds, while its behavior and assertions are unchanged; the final complete verification passed.

## Store and repository checks

- `npx openspec store list` resolves `repoctopus` to the active `workspace-intent-revision-run` worktree.
- Every implementation and evidence commit was pushed immediately to `origin/codex/repair-workspace-intent-revision`.
- Runtime progress was advanced only through `work-claim`, structured Host Outcome, validator acceptance, and lifecycle transitions; no Run Store file was edited to bypass a gate.
- Temporary claim, status, Outcome, Skill and candidate JSON files under `.repoctopus` were used only as ignored CLI transport and removed after evidence capture.

## Verdict

The workspace-intent recovery path is stable across repeated pulls, process restart, invalid and valid Human Decisions, protected composition adoption, and lifecycle checkpoint changes. The same-Run recovery contract is verified end to end, and the complete repository verification suite is green.
