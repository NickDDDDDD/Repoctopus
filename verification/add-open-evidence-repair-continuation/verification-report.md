# Open Evidence Repair Continuation Verification Report

## Reproducible subject

- Change: `add-open-evidence-repair-continuation`
- Tested implementation commit: `1b5e723cbc54342b506016dae657941ca348492f`
- Package: `repoctopus@0.1.0`
- Package bytes: `990977`
- Package SHA-256: `ac72560e72d203948bc21b9c4955c0e41fb95f4a94d475089a0fa1d635678059`
- Change Run: `change-repoctopus-add-open-evidence-repair-continuation-602296cb21eb5ebc`
- Platform: Windows x64
- Node.js: `24.21.0`

The tested commit is the packaged product and checker boundary. Later commits may change only OpenSpec state or verification evidence. The checker discovers the nearest ancestor report that has no later product or checker changes, then reproduces the package checksum from the current checkout. It orders equal-distance candidates by normalized repository-relative path so selection is deterministic across filesystems.

## Runtime invariants proved

1. Deterministic Open rejection atomically replaces the invalid Work with one executable `change.intake` repair Work and retires the prior execution checkpoint in the same lifecycle transition.
2. Provider unavailability preserves the accepted Host Outcome and returns reconciliation facts without replaying the Host.
3. Post-approval Open revalidation advances only when the current Provider observation matches the approved planning identity; deterministic drift returns to repair while unknown observation remains reconciliation.
4. Verify failure creates a Runtime-selected Build Plan revision. A submitted Plan Outcome is processed before stale Evidence-input waiting, clears `verificationInvalidation`, and advances to the next Build Action.
5. Repeated `run next` and `resume` preserve the authoritative Work/epoch and do not duplicate Host invocation.
6. Trajectory and OTLP expose bounded recovery facts; high-cardinality identities remain trace-only.

## Verification evidence

The production-composition regression executed a real single-repository autonomous lifecycle. It forced Verify input drift, observed `Verify -> Build Plan`, submitted the managed Plan Outcome, confirmed `validator-pending -> Build Execute`, confirmed invalidation clearance, resumed without another Host invocation, and completed the repaired Build through Verify and Archive.

The first formal Evidence attempt intentionally reached the report freshness boundary after all product checks passed:

```text
150 test files passed
659 tests passed; 2 skipped
TypeScript, Desktop TypeScript, ESLint, CLI/Desktop builds, generated output,
brand, architecture, provenance, Dashboard salvage and strict OpenSpec passed
```

Only the stale historical managed-report pin failed. After replacing that pin with the generic nearest-valid-report checker, the complete command succeeded on the tested implementation commit:

```text
npm run verify
150 test files passed
659 tests passed; 2 skipped
TypeScript, Desktop TypeScript, ESLint, CLI/Desktop builds, generated output,
brand, architecture, provenance, Dashboard salvage, strict OpenSpec and
managed lifecycle report reproduction passed
```

The checker is part of the pinned boundary and cannot authorize later changes to itself. It reproduces the package checksum and rejects any later product or checker change; only OpenSpec state and verification evidence may follow the tested commit.

Additional focused checks passed:

```text
npx vitest run test/managed-change-execution.e2e.test.ts -t "autonomous mode with one business rep"
npx vitest run test/build-orchestration-characterization.test.ts test/composition-compatibility.test.ts test/project-composition.test.ts
npm run typecheck
npm run typecheck:desktop
npm run lint -- --quiet
npm run check:architecture
npm run check:provenance
npm run check:generated
npm run spec:validate
```

Independent Spec and Standards review axes found no remaining blocking findings after the production-composition regression replaced the earlier source-regex assertion.

## Cleanup and delivery

- Every implementation commit was pushed immediately to `origin/codex/add-open-evidence-repair-continuation`.
- Runtime state was advanced only through managed Work claims, structured Outcomes, Validator acceptance, Evidence Gate transitions and trusted Human Decisions; the Run Store was not edited.
- Temporary package archives, review candidates and local Evidence transport files are removed after lifecycle completion.

## Verdict

Open Evidence repair is a real same-Run continuation rather than a projection label. The Runtime owns recovery selection and phase advancement, Host execution remains replay-safe, and the complete lifecycle now has behavior-level regression coverage for the Verify-repair ordering that self-hosting exposed.
