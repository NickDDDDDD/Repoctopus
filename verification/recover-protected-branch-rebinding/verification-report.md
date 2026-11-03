# Protected Branch Rebinding Recovery Verification Report

## Reproducible subject

- Change: `recover-protected-branch-rebinding`
- Tested implementation commit: `59e39354fdebff6cfc69b2f26cbf26a904e4c1bf`
- Package: `repoctopus@0.1.0`
- Package content SHA-256: `58f90e12e9d4f8f99bab2dfd9a0f8a390d612586774cb3a49d4b21ddf10118c7`
- Package files: `450`
- Package content bytes: `5409599`
- Controller: `@rpamis/comet@0.5.1`
- Platform: Windows x64
- Node.js: `24.21.0`

The tested implementation commit is the packaged-product boundary. Later commits may contain only OpenSpec, Comet, or verification evidence. `check:managed-execution-report` independently rebuilds the npm package and rejects any later packaged-product change or checksum drift.

## Runtime invariants proved

1. A rejected Build Plan authorizes rebinding only when the current Work is the same rejected `build.plan`, the continuation is `awaiting-correction`, and the observed drift changes only branches for the exact protected writable repository set.
2. `run next` and `run resume` consume the same pure classifier. Path, remote, topology, repository add/remove, unrelated branch, detached checkout, Host, or capability drift remains fail-closed.
3. Authorized recovery preserves the Run, Design approval, Build Strategy, OpenSpec Tasks, rejected Plan Outcome, and binding history while dispatching exactly one `build.configure` Work at a new check epoch.
4. A matching legacy branch-only reconciliation poison can be cleared only when its reconciliation digest matches trajectory-attested authorization evidence. A caller-provided option cannot bootstrap authorization.
5. Repeated resume is idempotent: it does not create a second Configure Work or duplicate the successful rebinding transition.
6. Rebinding telemetry records the entrypoint, bounded result, poison-recovery flag, repository count, and trace-only authorization digest. Metric labels contain no branch, repository, path, remote, Run ID, or digest.
7. The protected `workflow-runs` plugin adopts only its exact direct predecessor implementation identity; older unknown implementations still require migration.

## Production multi-repository evidence

The preserved `add-compact-task-status-v2` acceptance Run initially contained a rejected Build Plan and a branch-only reconciliation poison. The three writable repositories had already been switched and pushed to `codex/add-compact-task-status-v2` while the read-only backend remained on `main`.

Using the repaired product branch, normal `run resume` recovered that same Run without Store edits. The trajectory recorded one `authorizedBranchRebind` with `entrypoint=resume`, `poisonRecovery=true`, and `repositoryCount=3`. Runtime cleared `reconciliationRequired`, retained Binding revision 1 in history, created Binding revision 2 for the published feature branches, and accepted the same three-package Build Plan as Plan revision 1. The acceptance Run then stopped at its intended human decision for a cross-repository high-risk Plan; no approval was forged for that separate simulated business Change.

## Commands and results

Executed on Windows with Node.js `24.21.0`:

```text
npx --yes --package=@rpamis/comet@0.5.1 comet classic openspec -- validate recover-protected-branch-rebinding --strict
  Change is valid

npx vitest run test/authorized-protected-branch-rebind.test.ts test/runtime.test.ts test/telemetry-mapping.test.ts test/observation-envelope.test.ts test/runtime-stability.test.ts test/composition-compatibility.test.ts
  6 files passed; 56 tests passed

npm run verify
  typecheck, Desktop typecheck, lint, CLI/Desktop builds passed
  180 test files passed
  843 tests passed; 2 skipped
  generated, brand, architecture, provenance and Dashboard salvage checks passed
  18 strict OpenSpec items passed; 0 failed
  pre-report freshness gate correctly requested this report

npx vitest run test/e2e/desktop-run-activation.e2e.test.ts
  2 tests passed after stopping the source Desktop started by the acceptance Run
```

## Independent isolation finding

The first full verification run found that the real Desktop activation E2E shares Electron's product-wide single-instance lock with a source Desktop already launched by the acceptance Run. The E2E process forwarded its context to that existing instance and then waited for discovery in its own temporary profile, causing a timeout. Stopping the exact acceptance-owned source Desktop made the unchanged E2E pass 2/2. This is a separate test-isolation issue: a future Change should make the E2E explicitly control or isolate the product-wide single-instance owner rather than assume no Repoctopus instance is running.

## Cleanup

- The source Desktop process tree started by the acceptance Run was stopped before the final Desktop E2E and full verification.
- Temporary npm package archives and manual Desktop Host diagnostic directories are removed during final cleanup.
- Formal Run, trajectory, OpenSpec, test, and verification evidence are retained.
- No Runtime Store was edited, migrated, or bypassed.

## Verdict

The packaged implementation satisfies the approved protected-branch recovery, exact predecessor compatibility, multi-repository binding, idempotency, fail-closed drift handling, telemetry, architecture, provenance, and strict specification requirements. The final remaining lifecycle work is to validate this report against the reproducible package digest, clean temporary diagnostics, and let Comet Verify/Archive consume the evidence.
