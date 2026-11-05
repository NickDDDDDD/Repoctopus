# Atomic Build Work Outcome Acceptance Verification Report

## Reproducible subject

- Change: `repair-atomic-work-outcome-acceptance`
- Tested implementation commit: `8a121d968af43146f9513e7ec0947e5fd6bcab61`
- Package: `repoctopus@0.1.0`
- Package content SHA-256: `c4c74826fef0e928e4e3125e74c00b4f39f3a3c4f491a36a6eafe89b3bf4aba8`
- Package files: `458`
- Package content bytes: `5584114`
- Controller: `@rpamis/comet@0.5.1`
- Platform: Windows x64
- Node.js: `24.21.0`

The tested implementation commit is the packaged-product boundary. Later commits may contain only
OpenSpec, Comet or verification evidence. `check:managed-execution-report` independently rebuilds
the npm package and rejects packaged-product changes or semantic package drift.

## Runtime invariants proved

1. A Host submission remains pending until identity/protocol, schema, domain, lifecycle-validator
   and transition-feasibility checks have all succeeded.
2. Configure, Plan, Execute and Check resolve their acceptance behavior from the authoritative
   `WorkDescriptor.kind` registry. Unknown Build Work kinds fail closed.
3. A correctable rejection preserves Work, claim, attempt, check epoch, invocation, packet and the
   rejected submission. A corrected candidate requires a new submission identity.
4. A processing error remains pending. It is not reclassified as a Host correction and does not
   enter unknown-result reconciliation.
5. The guarded terminal commit rechecks every stable identity and the validation-record digest.
   A stale or forged validation record cannot bind an Outcome.
6. Transition feasibility is preflighted by the canonical pure lifecycle reducers before terminal
   acceptance. No Build path may first bind an Outcome and discover afterwards that the required
   lifecycle observation or recovery decision is illegal.
7. Execute retains its external-effect journal and workspace checkpoint. Acceptance does not
   duplicate Host effects, repository commits or specification task projection after interruption.
8. Inline Host execution, external `work-outcome` submission and cold recovery share one
   acceptance coordinator and one disposition model.

## Acceptance evidence

The focused matrix covers Configure, Plan, Execute and Check at schema, domain, validator and
transition-feasibility boundaries. Every failure occurs before the terminal bind. It also verifies
idempotent submission replay, conflicting digest rejection, corrected submission acceptance,
interruption recovery and telemetry cardinality.

The managed multi-repository acceptance matrix executes six complete scenarios: autonomous
single- and multi-repository runs, subagent-driven multi-repository execution, protected writable
repositories, protected-branch recovery and cross-process recovery. Round 8 submits a structurally
valid Configure candidate with the wrong strategy digest, observes `awaiting-correction`, submits a
new corrected candidate in the same invocation, and continues through Archive without changing
the original execution identities.

## Commands and results

Executed on Windows with Node.js `24.21.0`:

```text
focused Build outcome acceptance and lifecycle matrix
  134 tests passed
  Configure, Plan, Execute and Check pre-acceptance boundaries passed

external Host, recovery and telemetry matrix
  68 tests passed
  external capability, cold recovery and bounded OTLP facts passed

npx vitest run test/managed-change-execution.e2e.test.ts
  complete managed acceptance matrix passed: 6/6 scenarios
  Round 8 correction continued in the same invocation through Archive

npm run typecheck
npm run lint
npm run check:architecture
npm run check:provenance
  all passed

npm run verify (package-boundary run)
  complete Vitest matrix passed: 193 test files; 1 skipped
  971 tests passed; 3 explicitly skipped (974 total)
  generated, brand, architecture, provenance and Dashboard salvage passed
  strict OpenSpec passed: 19 items, 0 failed
  final report gate correctly required rebinding after the composition identity fixture changed
```

The composition fixture is part of the npm package, so its corrected digest changed the semantic
package identity. This report binds the resulting package boundary; a final complete repository
verification is executed against this binding before Verify and Archive complete.

## Protocol documentation

- `docs/architecture.md` defines the single acceptance coordinator and transition-owner boundary.
- `docs/runtime-state.md` defines acceptance order, correction identity, pending processing errors
  and the separation from unknown-result reconciliation.
- `docs/telemetry.md` defines bounded accepted, rejected, processing-error, validator and
  continuation observations without payload or free-text metric labels.

## Comet alignment

- Adopted: immutable action/work identity, parse-then-validate candidate handling, pre-commit
  transition feasibility, exact correction identity and checkpoint-based continuation.
- Adapted: Repoctopus retains OpenSpec authority, Cordis runtime composition, multi-repository
  Binding, external Hosts, two-phase external effects and OTLP projection.
- Not adopted: Comet-specific specification artifacts, child workflows or a second transition
  authority beside Repoctopus lifecycle reducers.

## Cleanup

- The temporary npm archive and its dedicated package directory were deleted after computing the
  semantic package digest.
- Managed acceptance repositories and generated process artifacts are removed by their verified
  cleanup hooks.
- No debug log, scratch JSON, compatibility reader or alternate acceptance path remains.

## Verdict

The implementation establishes atomic Build Work Outcome acceptance: candidate validation and
transition feasibility precede terminal binding, rejected and processing-error paths preserve the
correct audit identities, and all Build Work kinds share one fail-closed protocol. Final delivery
requires the complete repository verification, fixed-upstream check and independent thorough
review recorded below.
