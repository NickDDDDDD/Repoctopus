# Runtime Continuation Stability Verification Report

## Reproducible subject

- Change: `stabilize-runtime-continuation`
- Tested implementation commit: `3c0d18fa69bd6deceb8de30fa995c68a8ea41436`
- Package: `repoctopus@0.1.0`
- Package bytes: `1023660`
- Package SHA-256: `3a4b1c3aa9d42542a6baa22c62eec7904604d6a3277fb7a4ef3e126c6b8cdd80`
- Controller: `@rpamis/comet@0.5.1`
- Platform: Windows x64
- Node.js: `24.21.0`

The tested implementation commit is the packaged-product boundary. Later commits may contain only OpenSpec state or verification evidence. `check:managed-execution-report` rejects any later packaged-product or checker change and independently reproduces the npm package checksum.

## Runtime invariants proved

1. `run status` is a read-only projection of committed Run, checkpoint, trajectory, and continuation facts. It does not probe a Host, rebuild a packet, scan Git, or append recovery events.
2. `run next` selects a bounded continuation, commits `continuation.selected`, and then returns the committed projection. Repeated pulls preserve the Work identity and do not duplicate claims, decisions, invalidations, or external intents.
3. Planning semantic, approval authority, validation observation, publication provenance, composition, Build Configuration, Build Plan, execution, and verification identities have separate owners and dependency edges.
4. Design rework suspends the Build Protocol. It retains Tasks, Configuration, Plan, evidence, and unaffected package completions; revalidation invalidates only descendants whose typed inputs changed.
5. A compatible composition implementation change records one adoption without rebuilding a Human Decision. A protected incompatible change is readable as `migration_required` but cannot write.
6. Publication-only source OID changes do not change Specification Compatibility or return a Build Run to Design.
7. Pre-release checkpoints and Planning snapshots that do not satisfy the current schema remain byte-preserving and read-only. Runtime does not use a generation, dual reader, fallback adapter, Store repair command, or current-content reconstruction.
8. Run mutation, Work claim, Human Decision, invalidation, Host invocation ownership, and side-effect intent use revision/state-version fencing. Concurrent Runners converge on one committed invocation; a losing Runner does not call the Host.
9. Business push/MR and Specification push/MR publication persist `invoking` before every external call. An unknown result projects `reconcile / external-result-unknown`; continuation observes the exact OID/MR and never repeats the uncertain side effect.

## Verification evidence

The production-composition black box starts fresh Changes through the packaged CLI and uses real Git repositories, the OpenSpec Provider, the file Run Store, managed Host outcomes, process restarts, Human Decisions, Build Configure/Plan/Execute/Check, Verify, and Archive.

The added upgrade scenarios run through `bin/repoctopus.js` in separate Node processes:

- a stateless implementation predecessor is adopted exactly once and retains the current approved Open request;
- a protected `workflow-runs` predecessor without an exact compatibility declaration reports `migration_required`, while `run status` leaves trajectory bytes unchanged;
- a remote source OID update with unchanged planning artifacts reports `specificationCompatibility: same`, retains the Design approval and Build Configuration decision, and stays in Build.

The single- and multi-repository partial-revalidation tests prove that a changed package is redone while unaffected completion, evidence, Configuration binding, repository IDs, and package topology remain stable.

## Commands and results

Executed on Windows with Node.js `24.21.0`:

```text
npm run typecheck && npm run lint && npm test
  156 test files passed
  696 tests passed; 2 skipped
  CLI and Desktop production builds passed

npx vitest run test/managed-change-execution.e2e.test.ts
  1 test file passed; 4 tests passed
  all single/multi-repository autonomous and subagent-driven lifecycles completed

npm run spec:validate
  19 strict OpenSpec items passed; 0 failed

npm run check:architecture
  276 production sources and 21 capability owners verified

npm run check:provenance
  20 Comet-derived files, 60 immutable Cordis files, 33 Matt Skill files,
  8 fixed DSH packages, and 5 DSH Desktop references verified
```

The final pre-report `npm run verify` passed type checks, lint, builds, all 156 test files, generated-output checks, naming, architecture, provenance, Dashboard salvage, and strict OpenSpec validation. The report freshness gate then correctly rejected the previous package boundary because the independent review fixes changed packaged-product files. This report binds the corrected package; a subsequent complete `npm run verify` must reproduce its checksum before the Change can pass Verify.

## Telemetry evidence

Trajectory and OTLP expose bounded phase, Work, Build Action, continuation, invalidation, adoption, approval, validation, claim, invocation, Outcome, and recovery facts. Metric dimensions use only bounded enums and counts. Run IDs, Work IDs, Task/package/repository identities, digests, Skill names, paths, diagnostics, and Agent identities remain Trace/Event-only values.

`repoctopus.runtime.stability.events` counts versioned stability facts. `repoctopus.runtime.stability.items` records retained/invalidated identities and completion counts as measurement values rather than labels. Repeated `run status` calls cannot inflate continuation or checkpoint recovery metrics because status does not append trajectory events.

## Cleanup

- The package checksum archive is temporary and is removed after the report is written.
- No Runtime Store was edited to bypass a lifecycle gate.
- No compatibility reader, migration command, generation field, webhook, daemon, or second specification authority was introduced.
- Final cleanup must confirm that no temporary package directory, debug log, payload, receiver, or test Workspace remains.

## Verdict

The packaged implementation has passed its Runtime, domain, service, CLI, multi-repository, recovery, identity, architecture, provenance, and strict specification checks. Final approval still requires the report checksum to reproduce under `npm run verify`, Comet strict validation, cleanup, and the separately tracked independent high-risk review.
