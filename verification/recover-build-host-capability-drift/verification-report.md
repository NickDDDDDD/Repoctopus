# Build Host Capability Recovery Verification Report

## Reproducible subject

- Change: `recover-build-host-capability-drift`
- Tested implementation commit: `7f740c1848a06731ac41746764e2d2124ff18012`
- Package: `repoctopus@0.1.0`
- Package content SHA-256: `25f8fdb077a9f21c618271ddd1770ecc958794745a8dadc791a2f4675671ebc9`
- Package files: `450`
- Package content bytes: `5401391`
- Controller: `@rpamis/comet@0.5.1`
- Platform: Windows x64
- Node.js: `24.21.0`

The tested implementation commit is the packaged-product boundary. Later commits may contain
only OpenSpec, Comet or verification evidence. `check:managed-execution-report` independently
rebuilds the npm package and rejects packaged-product changes or semantic package drift.

## Runtime invariants proved

1. The current immutable Work is the sole Host capability authority. Configure, Plan, Execute and
   Check use one `WorkDispatcher` pre-claim validator.
2. Execution Binding schema v3 owns coordinator Host identity and multi-repository workspace
   facts, but no capability list or digest. Plan Evidence also contains no Host capability digest.
3. Configure requires only its current read/specification/mode capabilities. Future repository
   write and process capabilities are checked only when Execute or Check is claimed.
4. Plan, Execute and Check Outcome processing binds the original claim, packet, invocation and
   submission identities. A legal Work-specific capability set never rebuilds the Binding.
5. A capability-deficient Host creates no claim, packet ownership or invocation. It records one
   bounded `work.claim-capability-rejected` fact and leaves Strategy, Binding and approval intact.
6. Duplicate pull returns the authoritative claim, packet and invocation. It only resumes an
   incomplete claim-to-context-delivery checkpoint and never creates a second execution owner.
7. Unknown execution retains the original invocation and selects `reconcile`. A retry is possible
   only after authoritative not-executed evidence.
8. Binding revalidation is limited to coordinator Host and workspace-owned facts. Active legacy
   Binding schema returns structured `migration_required`; no compatibility reader is present.

## Historical and fresh acceptance evidence

The original round4 Store remains read-only. Its stable fixture records a Build Plan claim, packet,
external invocation and submission under Binding schema v1 before the Plan validator, plus SHA-256
digests for the original Run and trajectory files. Neither file was edited or migrated.

The fresh public external Host E2E creates real single- and multi-repository Git topologies. Both
variants execute Configure and Plan with exact read-only minimum capabilities, reject one Execute
claim without `repository.write`, accept the corrected Execute claim, commit and push every package,
complete Check with its own minimum capabilities and reach Verify. The multi-repository case runs
two packages. Both cases retain one Plan revision and record zero capability-driven Binding
revalidation transitions.

The same vertical test includes duplicate Plan pull, duplicate submission and a process restart.
The recovery matrix additionally covers concurrent invocation ownership and unknown reconciliation.

## Commands and results

Executed on Windows with Node.js `24.21.0`:

```text
npm run verify
  typecheck, Desktop typecheck, lint and CLI/Desktop builds passed
  complete Vitest matrix passed: 182 test files
  850 tests passed; 2 explicitly skipped
  generated, brand, architecture, provenance and Dashboard salvage passed
  strict OpenSpec passed: 18 items, 0 failed
  the pre-report freshness gate correctly requested this report

npx vitest run test/external-build-host-capability.e2e.test.ts
  single-repository external Host vertical acceptance passed
  multi-repository external Host vertical acceptance passed

npx vitest run test/work-capability-authority.test.ts test/work-execution-recovery.test.ts
  Work-scoped capability rejection, duplicate pull and unknown recovery passed
```

The first full verification pass found two intentionally frozen identity snapshots and a Windows
desktop activation deadline that was too short under four-worker process load. The snapshots were
updated to the current deterministic values. The default activation deadline now matches the
existing 15-second Desktop Host readiness window; explicit short-deadline rejection tests remain
unchanged. Focused tests passed before the complete green rerun above.

## Telemetry evidence

Trajectory, Desktop projection and OTLP distinguish capability claim rejection, blocked execution,
unknown/reconcile and true Binding drift. Metrics use bounded event/result/reason dimensions.
Capability text, Host/Work/claim identity, paths and digests remain outside Metric labels.

## Cleanup

- The temporary package archive used to compute the semantic digest was deleted.
- Temporary single- and multi-repository E2E directories are removed by the verified test hooks.
- The preserved round4 Store and trajectory remain untouched as historical evidence.
- No debug log, scratch JSON, Store edit, compatibility reader, daemon or secondary task authority
  was introduced.

## Verdict

The packaged implementation replaces cross-Work capability identity with one Work-scoped claim
contract, preserves external execution ownership across recovery, and passes real single- and
multi-repository acceptance. The remaining lifecycle work is to reproduce this report checksum,
complete Comet Verify and archive the OpenSpec Change.
