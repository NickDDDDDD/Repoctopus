# Planning Approval / Lifecycle Coherence Verification Report

## Reproducible subject

- Change: `repair-planning-approval-lifecycle-coherence`
- Tested implementation commit: `42dc2d5165d9da8df705eeb71e0e78bc57af8e2d`
- Package: `repoctopus@0.1.0`
- Package SHA-256: `b2cd255a22cf0f46aba4aa272b64bb4e520c84467128eb1d013cb336c3c017d3`
- OpenSpec Provider: `openspec@1.14.3`
- Comet release reference: `0.5.1` / `35c9860b77b42bafa0c2d80d8d695889f888a924`
- Comet audited branch head: `9208b4beef7a71e45b1bbf734eee50af63e4059b`

The implementation commit is the packaged product boundary. Later commits may change only OpenSpec state, verification evidence, or the report checker; any later packaged product change makes this report stale. The package checksum was produced with `npm pack --json --ignore-scripts`; the temporary package and Comet audit clones were removed after hashing and review.

## Invariants proved

1. A later-phase planning authority observation is read-only. It inspects the Provider semantic digest, strict validation and the existing trusted Design approval without refreshing the approval Store.
2. Planning invalidation is revision-bound through `expectedRevision/fromPhase`. One Run CAS returns directly to Design with a new `specification.plan` Work, new checkEpoch and cleared downstream inputs; there is no `Design/currentWork=null` intermediate state.
3. The existing generic lifecycle CAS retirement removes any execution checkpoint whose workId/checkEpoch no longer matches the new lifecycle Work. No planning-specific checkpoint deletion path was added.
4. Read-only status/recovery ignores a legacy superseded checkpoint and projects the lifecycle Work. The next protected `run next/resume` removes that checkpoint once through `recovery.reconciled` before a new claim.
5. Archive planning authority is checked after Evidence freshness and before specification closure, Git publication or MR adapters. Invalid authority returns a Design checkpoint with the bounded `change.planning-revision-required` diagnostic.
6. Planning invalidation and checkpoint reconciliation emit bounded trajectory/OTLP facts. Metric labels contain only bounded phase, work kind, invalidation kind, continuation and booleans; digests, paths, free text and run/work identity remain trace-only.

## Comet comparison

The design follows Comet Classic's revision-bound revision command and same-CAS next handoff, plus Comet Native's `stateVersion/expectedAction` stale-continuation fencing. Repoctopus keeps its OpenSpec Provider, multi-repository ProjectSnapshot and immutable Work Descriptor architecture; no Comet SDK, single-repository state root, daemon, webhook or second approval phase was introduced.

The daily upstream audit advanced Comet `master` from `4901cac` to `9208b4b`. The new commit only fixes UTF-8 BOM byte identity in Native candidate checks. It does not alter revision fencing or planning recovery, and no registered Comet source used by Repoctopus changed. DSH remained current.

## Failure and recovery matrix

| Boundary                                            | Verified result                                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Provider semantic digest changes in Build/Verify    | One revision-bound transition installs a new Design Work and invalidates downstream Build/Verify state |
| Design approval is missing or stale                 | Observation returns `approval-authority`; approval Store remains unchanged until the Design gate       |
| Two Runners submit the same observation             | Stale revision/phase is rejected; the newer phase/Work cannot be overwritten                           |
| Lifecycle changes while old execution remains       | Generic same-CAS retirement removes the mismatch and preserves historical trajectory events            |
| Legacy checkpoint survives a prior torn write       | Status reports `checkpoint-superseded`; the protected pull emits one idempotent reconciliation event   |
| Archive authority is invalid before preflight       | Runtime returns to Design before closure/publication adapters                                          |
| Normal Build workspace is dirty from implementation | Later-phase observation uses the approved branch identity and does not require a clean working tree    |
| Process restarts during managed execution           | The same Run and immutable packet resume; no old Work becomes current                                  |

## Verification commands

Executed on Windows with Node.js `24.21.0`:

```text
npm run typecheck
npm run typecheck:desktop
npm run lint
npm run build
npm run build:desktop
  passed

npx vitest run test/managed-change-execution.e2e.test.ts
  1 file passed; 4 tests passed
  all autonomous/subagent and single/multi-repository combinations completed
  Open -> Design -> Build -> Verify -> Archive; process restart recovery passed

npm test
  142 files passed
  584 tests passed; 2 repository-owned tests skipped

npm run check:generated
npm run check:brand
npm run check:architecture
npm run check:provenance
npm run check:dashboard-salvage
npm run spec:validate
  generated output, naming, 265-source architecture ownership, provenance,
  Dashboard salvage and 15 strict OpenSpec items passed

npm run check:upstream
  DSH current at ce7073d51254c26cd63b22a60835b8f948deb447
  Comet current at 9208b4beef7a71e45b1bbf734eee50af63e4059b
```

## Verdict

Planning approval, lifecycle phase/current Work and execution continuation now converge through one revision-fenced Run authority. Queries remain read-only, protected pulls perform the only legacy reconciliation write, and Archive fails closed before external side effects. The two observed torn-state failures are covered without adding lifecycle generations, waiting mechanisms or compatibility debt.
