# Incremental Workflow Recovery Verification Report

## Reproducible subject

- Change: `stabilize-incremental-workflow-recovery`
- Tested implementation commit: `a94af4b8b49332a5b858a7e41a1e5c299fec5d2a`
- Package: `repoctopus@0.1.0`
- Package content SHA-256: `28ea217e7d987d46da10e346f1a9c411719da3080841f2e6b8abdfb07c7e0b77`
- Package files: `456`
- Package content bytes: `5547145`
- Controller: `@rpamis/comet@0.5.1`
- Platform: Windows x64
- Node.js: `24.21.0`

The tested implementation commit is the packaged-product boundary. Later commits may contain only
OpenSpec, Comet or verification evidence. `check:managed-execution-report` independently rebuilds
the npm package and rejects packaged-product changes or semantic package drift.

## Runtime invariants proved

1. Runtime is the sole transition authority. Hosts report observations and Outcomes; they cannot
   select a lifecycle phase or synthesize an equivalent transition.
2. Recovery is classified once against ordered authority layers. The highest affected authority
   selects `revise-design`, `revise-plan`, `continue-build` or precise evidence invalidation.
3. `continue-build` preserves the current execution identity. Planning-only repair returns to the
   unique Build Configure checkpoint without manufacturing a Design regression.
4. Planning semantics, implementation content, execution control, optional Git identity and
   publication provenance have separate stable identities. Task completion checkboxes and
   evidence-only commits do not invalidate an approved Build Protocol.
5. Receipt, Bundle, Gate, Build Check and Verification Input declare their dependencies. Recovery
   invalidates only the transitive dependent closure and preserves unrelated accepted evidence.
6. Evidence drift and evidence unavailability are distinct. Provider or infrastructure
   unavailability remains blocked/retry and does not silently return to Build or Design.
7. A rejected Build Plan checkpoint can be retired only by the exact authorized recovery event.
   Ordinary unresolved invocations remain fail-closed, and the original claim, packet, invocation
   and submission remain auditable.
8. Open and Design validate Requirement identities and closure feasibility before Build. Build
   receives structured identities and does not reinterpret specification prose.

## Historical and fresh acceptance evidence

The deterministic fixture replays the previously observed multi-repository failures: incorrect TDD
task slicing, test-surface corrections, task-checkbox completion, true planning changes and
verification evidence drift. Repeated replay converges to one checkpoint and one logical recovery
decision.

The managed acceptance matrix creates real Git repositories and executes six complete scenarios.
It verifies cold recovery, duplicate pull, interrupted execution, rejected Plan rebind,
multi-repository phase travel, Work and Skill projection, precise Evidence invalidation and OTLP
recovery events. All scenarios reached their expected terminal checkpoint without an unjustified
Build-to-Design regression.

## Commands and results

Executed on Windows with Node.js `24.21.0`:

```text
npm run verify
  typecheck, Desktop typecheck, lint and CLI/Desktop builds passed
  complete Vitest matrix passed: 189 test files
  938 tests passed; 2 explicitly skipped (940 total)
  generated, brand, architecture, provenance and Dashboard salvage passed
  strict OpenSpec passed: 18 items, 0 failed
  the pre-report freshness gate correctly requested this report

npx vitest run test/managed-change-execution.e2e.test.ts
  complete managed acceptance matrix passed: 6/6 scenarios

focused Runtime authority and recovery matrix
  118 tests passed
  precise invalidation, transition ownership, duplicate recovery and forged requests passed
```

The verification campaign found three integration defects before this report: the package-control
file limit was smaller than Comet's projected manifest, Specification planning identity was not
explicitly projected, and lifecycle recovery had acquired a second transition owner. The control
guard now retains its file-count, total-size, identity and race checks with a sufficient per-file
limit; planning identity is explicit; and all recovery materialization is centralized in the
canonical lifecycle transition module. Architecture and provenance gates enforce those boundaries.

## Telemetry evidence

Trajectory, Desktop projection and OTLP expose `recovery.observed`, `recovery.classified`,
`recovery.applied` and evidence invalidation with bounded decision, authority-layer, reason and
result dimensions. Paths, Requirement text, commit identities, digests and free-form findings are
excluded from Metric labels. Stable run/change correlation remains available for workflow-health
analysis.

## Comet alignment

- Adopted: Runtime-owned Action selection, immutable execution identity, ordered recovery,
  checkpoint continuation and incremental invalidation.
- Adapted: OpenSpec remains the specification authority, and Repoctopus keeps its cross-repository
  Binding, external Host and OTLP architecture.
- Not adopted: Comet-specific Build Plan documents, child workflows and any compatibility reader
  for retired Repoctopus lifecycle generations.

## Cleanup

- The temporary package archive used to compute the semantic digest is deleted after the report
  freshness check.
- Managed acceptance repositories and generated process artifacts are removed by verified hooks.
- No debug log, scratch JSON, daemon, compatibility reader or secondary transition authority was
  introduced.

## Verdict

The packaged implementation replaces coarse phase regression with an authority-ordered,
incremental and replay-safe recovery protocol. Its cross-repository acceptance, evidence graph,
telemetry and fail-closed boundaries are verified. The remaining lifecycle work is to reproduce
this package checksum, complete Comet Verify and archive the OpenSpec Change.
