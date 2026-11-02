# Open Observation Continuation Recovery Verification Report

## Reproducible subject

- Change: `recover-open-observation-continuation`
- Tested implementation commit: `a9d70dddcad31a207662c4bdbfd947b9d508cd47`
- Package: `repoctopus@0.1.0`
- Package content SHA-256: `61c9be4da8203f6a8334e8e6e76745904fa5a1085b957cd448e93fabc3ed80f5`
- Package files: `447`
- Package content bytes: `5267734`
- Controller: `@rpamis/comet@0.5.1`
- Platform: Windows x64
- Node.js: `24.21.0`

The tested implementation commit is the packaged-product boundary. Later commits may contain only OpenSpec, Comet, plan or verification evidence. `check:managed-execution-report` independently rebuilds the npm package and rejects any later packaged-product change or checksum drift.

## Runtime invariants proved

1. Open `validated` Work is classified as `reobserve/open-gate-pending`; `run next` continues the planning gate without replaying the Host or reverting the Work to `outcome`.
2. Provider validation and planning-gate observation failures both preserve the same Work, attempt, check epoch, packet, Host invocation, accepted Outcome, Receipt and Skill consumption.
3. `run resume` is read-only with respect to Provider and Host execution. It restores durable state and projects the current continuation.
4. Work recovery, managed dispatch, `run next`, committed status projection and lifecycle next actions use the same pure continuation classifier.
5. Project reconciliation reports `same | content | identity`. HEAD/worktree drift is content and does not set the global blocker; branch, remote, path, project/root identity, repository topology and diagnostics remain identity drift and fail closed.
6. Generic non-Change workflow Runs stay outside the Change Work classifier and retain their original `wait | done` recovery semantics.
7. Open observation stage and Project reconciliation class are bounded public telemetry dimensions. Duplicate pulls create suppressed dispatch facts without duplicating Host or Skill execution.

## Production-boundary evidence

The production-composition Windows fixture executes the complete `Open -> Design -> Build -> Verify -> Archive` lifecycle in autonomous single-repository, autonomous multi-repository and subagent-driven multi-repository modes. In the single-repository path it first accepts a real Open Host Outcome and four OpenSpec artifacts, then injects failures at Provider validation, published branch observation and planning assessment. The Run retains the authoritative invocation throughout.

After the published branch timeout, the fixture calls `run resume` against the real current Workspace snapshot. The result reports `changeClass=content`, `requiresReconciliation=false`, `status=validated` and `reobserve/open-gate-pending`. Provider recovery followed by concurrent `run next` calls creates one Open Human Decision boundary and no extra Host invocation. The same fixture classifies branch, remote and topology mutations as identity drift. Fresh multi-repository fixtures continue through Design, Build, Verify and Archive.

## Commands and results

Executed on Windows with Node.js `24.21.0`:

```text
npx vitest run test/managed-change-execution.e2e.test.ts --no-file-parallelism
  1 test file passed
  4 tests passed
  all production-composition lifecycle variants passed

npm run verify
  typecheck, Desktop typecheck, lint and CLI/Desktop builds passed
  174 test files passed
  793 tests passed; 2 skipped
  generated, brand, architecture, provenance and Dashboard salvage checks passed
  18 strict OpenSpec items passed; 0 failed
  pre-report freshness gate correctly requested this report

npm run check:provenance
  20 Comet-derived files, 60 immutable Cordis files, 33 Matt Skill files,
  8 fixed DSH packages and 5 DSH Desktop references verified
```

## Telemetry evidence

`continuation.selected` records the bounded Open observation stage as `provider-validation | planning-gate`, together with `continuation`, `reasonCode` and `hostReplayed=false`. Resume events expose only `repoctopus.project.reconciliation.class` and `repoctopus.project.reconciliation.required`; repository names, paths, remotes and diagnostic text do not become metric labels. Unit tests prove that exporter or duplicate-pull replay does not create another logical Host invocation or Skill consumption.

## Cleanup

- The temporary npm package archive was deleted immediately after computing its semantic package digest.
- Production E2E mock remotes and Run Stores were created under test-managed temporary directories and removed by fixture cleanup.
- No Runtime Store, checkpoint, Outcome or Receipt was edited to bypass the state machine.
- No daemon, webhook, compatibility reader, generation field or second continuation authority was introduced.

## Verdict

The packaged implementation satisfies the approved Open continuation recovery, content-versus-identity reconciliation, telemetry, concurrency, Windows CLI, multi-repository, architecture, provenance and strict specification requirements. The remaining lifecycle work is to commit this evidence, reproduce the package freshness check, and let Comet Verify and Archive consume the accepted report.
