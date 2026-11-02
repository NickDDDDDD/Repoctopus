# Runtime Workspace Binding Verification Report

## Reproducible subject

- Change: `stabilize-runtime-workspace-binding`
- Tested implementation commit: `a400771190d8e414c54ae427d1430bb22f618fc4`
- Package: `repoctopus@0.1.0`
- Package content SHA-256: `34ddb19dfe7caaf95923df02893e28d2dacffd167c0cd228c2f161dc727a4a13`
- Package files: `447`
- Package content bytes: `5261736`
- Controller: `@rpamis/comet@0.5.1`
- Platform: Windows x64
- Node.js: `24.21.0`

The tested implementation commit is the packaged-product boundary. Later commits may contain only OpenSpec, Comet, or verification evidence. `check:managed-execution-report` independently rebuilds the npm package and rejects any later packaged-product change or checksum drift.

## Runtime invariants proved

1. `ChangeStartBinding` freezes Workspace Repository, attached source branch, target branch, normalized remote identity, and configured multi-repository topology before Run creation.
2. Local path, HEAD, dirty/worktree digest, and observation time do not participate in binding identity; normal development therefore does not invalidate an existing Run.
3. Detached HEAD, source=target, remote mismatch, and invalid topology fail before RunStore initialization, initial Skill/Work persistence, or Desktop activation.
4. `startOrResume` returns a typed `started|resumed` disposition. Only `started` records initial Skills, composition, Work, and Desktop activation; `resumed` returns the Store-owned current Work.
5. Equivalent concurrent starts converge on one Run. Binding drift returns `runtime.workspace-binding-conflict` and leaves the original state, checkpoint, and trajectory unchanged.
6. Open Specification Provider unavailability projects `reobserve`, retaining the original Work, attempt, invocation, packet, and successful Host Outcome. It never calls Host reconciliation or repeats the Host.
7. Strict-invalid Open facts still install one unique repair Work and retire the rejected execution atomically.
8. Preflight rejection, creation, reuse, conflict, and Open reobservation use bounded canonical observations. Branches, remotes, paths, digests, and error text do not become metric labels.

## Production-boundary evidence

The Windows CLI fixture first runs `run start` from `main` with target `main` and receives the structured `runtime.workspace-binding.source-target-equal` failure. The Run directory remains absent. It then creates and publishes a feature branch, starts two concurrent CLI processes, and proves that both return the same Run and current Work. After switching to another published source branch, the same stable Run identity returns `runtime.workspace-binding-conflict`; the persisted Run and trajectory remain unchanged.

The managed production-composition fixture executes a real Open Host Outcome, makes the OpenSpec Provider fail once, observes `reobserve / open-observation-unavailable`, restores the Provider, and reaches Open review without another `change.intake` invocation. Desktop production E2E covers both an unavailable target with uninterrupted remote OTLP and a real source Electron receiving the correct Run context.

## Commands and results

Executed on Windows with Node.js `24.21.0`:

```text
npm run verify
  typecheck, Desktop typecheck, lint, CLI/Desktop builds passed
  174 test files passed
  773 tests passed; 2 skipped
  generated, brand, architecture, provenance and Dashboard salvage checks passed
  18 strict OpenSpec items passed; 0 failed
  pre-report freshness gate correctly requested this report

npx vitest run test/e2e/change-run-cli.e2e.test.ts
  target-branch rejection, public feature start/replay, and binding drift passed

npx vitest run test/managed-change-execution.e2e.test.ts -t "autonomous mode with one"
  full Open -> Design -> Build -> Verify -> Archive passed
  Open Provider reobservation retained the Host invocation

npm run check:provenance
  20 Comet-derived files, 60 immutable Cordis files, 33 Matt Skill files,
  8 fixed DSH packages, and 5 DSH Desktop references verified
```

## Telemetry evidence

`platform.change-start` records bounded `result`, `bindingError`, `runCreated`, `workCreated`, `checkpointChanged`, and `recovery` values through the durable canonical outbox. Open Provider retry records `continuation=reobserve`, `result=unavailable`, `reasonCode=open-observation-unavailable`, and `hostReplayed=false`. OTLP logs, traces, and metrics are derived from the same canonical envelopes and trajectory facts.

## Cleanup

- The old agent-lab Electron process that held the global single-instance lock was stopped before the final Desktop E2E rerun.
- The temporary npm package archive was moved out of the workspace after its semantic digest was computed; the verification gate uses its own automatically removed temporary directory.
- No Runtime Store was edited, migrated, or bypassed.
- No daemon, webhook, compatibility reader, generation field, or Runtime-owned Git checkout operation was introduced.

## Verdict

The packaged implementation satisfies the approved workspace binding, idempotent start, Open reobservation, telemetry, Windows CLI, Desktop, multi-repository, architecture, provenance, and strict specification requirements. The package checksum gate and Comet strict validation reproduced successfully; the remaining lifecycle step is to commit this evidence and let Comet Verify/Archive consume it.
