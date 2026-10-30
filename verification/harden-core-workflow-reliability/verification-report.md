# Core Workflow Reliability Verification Report

## Reproducible subject

- Change: `harden-core-workflow-reliability`
- Tested implementation commit: `0346b319b03c12f6904df3d8da70330b5bd1486c`
- Package: `repoctopus@0.1.0`
- Package SHA-256: `6133ffa18b083dda0746650f2e023404bcf887646b094fc17dbf28b6f1c16699`
- Checkpoint schema: `3`
- Packet store schema: `1`
- OpenSpec Provider: `openspec@1.14.3`

The implementation commit is the packaged product boundary. Later commits may change only OpenSpec state, verification evidence, or the report checker; any later packaged product change makes this report stale. The package checksum was produced with `npm pack --json --ignore-scripts` and the temporary archive directory was removed after hashing.

## Defects closed

1. A claimed Work no longer reconstructs execution context from mutable Skill, Provider, or OpenSpec state after restart. The complete deep-frozen packet is saved before the Run claim CAS and recovered only by the checkpoint identity.
2. OpenSpec official `skip_specs: true` now projects Delta Specs as `skipped`, with a stable semantic digest, instead of the false `missing` state.
3. OpenSpec `issues[].level` now maps case-insensitively to `info | warning | error`. Unknown levels fail closed, and `valid=true` plus any error becomes an explicit Provider contract conflict.
4. Packet and Specification reliability facts use the same durable Trajectory and canonical OTLP envelope for SigNoz and Desktop. Observation failure cannot change claim, recovery, validation, or Gate results.

## Failure and recovery matrix

| Boundary                                      | Verified result                                                                           |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Packet save fails before Run CAS              | No authoritative claim is bound and no Host delivery occurs                               |
| Same packet save repeats or races             | One immutable file; callers observe `created`/`reused` without temporary residue          |
| Run CAS loses after packet save               | Orphan content has no execution authority and cannot overwrite the winning claim          |
| Response is lost after claim                  | The same run/work/attempt/checkEpoch/packet digest is loaded from private content storage |
| Host changes four OpenSpec planning artifacts | Restart returns the original packet; `WorkContextAssembler` is not called                 |
| Host result is unknown                        | Runtime returns `reconcile` and never repeats the external invocation                     |
| Packet file is missing, truncated, or corrupt | Runtime keeps the original claim and returns `content-missing-or-corrupt`                 |
| Checkpoint predates schema 3                  | Runtime returns `migration-required`; no compatibility reconstruction exists              |
| OpenSpec artifact is officially skipped       | Planning manifest and approval accept the stable `skipped` digest                         |
| OpenSpec validation contains INFO             | INFO remains visible and does not become an error                                         |
| OpenSpec reports valid plus ERROR             | Result becomes invalid with `openspec.validation-contract-conflict`                       |

## Identity and disclosure evidence

- The packet content file is scoped to `.repoctopus/runs/<runId>/packets/<packetDigest>.json` and validated against runId, packet identity, Action Intent, current Work, attempt, checkEpoch, input digest, and composition digest on every read.
- Run state, checkpoint, trajectory, logs, OTLP and Desktop projection contain only bounded identity and status facts. Packet bodies, prompts, absolute paths, Provider metadata, and diagnostic messages are excluded by allowlists.
- Packet telemetry uses only `created | reused | recovered | missing | corrupt | legacy`. Specification telemetry uses only the four fixed artifact statuses, validity, highest severity, bounded counts, and contract-conflict.
- Desktop does not query RunStore, packet files, Git, or OpenSpec; replay, out-of-order delivery, and duplicate envelope IDs converge through the same projection reducer used by local OTLP ingestion.

## Verification commands

Executed on Windows with Node.js `24.21.0`:

```text
npm run typecheck
npm run typecheck:desktop
npm run lint
npm run build
npm run build:desktop
  passed

npx vitest run test/managed-change-execution.e2e.test.ts test/e2e/managed-execution-otlp.e2e.test.ts test/project-composition.test.ts test/desktop-host.e2e.test.ts
  4 files passed; 8 tests passed
  production composition exercised Open -> Design -> Build -> Verify -> Archive,
  single/multi-repository topology, both execution modes, real application restarts,
  original packet recovery and shared OTLP/Desktop delivery

npm test
  142 files passed
  580 tests passed; 2 repository-owned tests skipped

npm run check:generated
npm run check:brand
npm run check:architecture
npm run check:provenance
npm run check:dashboard-salvage
npm run spec:validate
  generated output, naming, 265-source architecture ownership, provenance,
  Dashboard salvage and 15 strict OpenSpec items passed
```

The first direct E2E invocation intentionally exposed a stale generated `dist` composition because Vitest had been run without the repository `pretest` build. The Runtime correctly rejected the source/dist mismatch as `migration_required`. Rebuilding production and Desktop artifacts made both sides use the same composition; the complete E2E and later full-suite run then passed. No compatibility exception was added.

## Verdict

The pull-based workflow now preserves one authoritative frozen Work packet across restart and mutable planning changes. OpenSpec normalization has one stable three-state/severity contract, and both SigNoz and Desktop observe the same bounded persisted facts. Unknown external results, missing content, legacy checkpoints, Provider contradictions, and telemetry failures all fail at their own boundary without replaying Host side effects or fabricating lifecycle progress.
