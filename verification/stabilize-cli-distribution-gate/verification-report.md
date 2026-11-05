# CLI Distribution and Cross-Platform Verification Report

## Reproducible subject

- Changes: `stabilize-cli-distribution-gate`, `stabilize-cross-platform-verification`
- Tested implementation commit: `327731bbb20869e1585460869d47201c04f99daa`
- Package: `repoctopus@0.1.0`
- Package content SHA-256: `632cbf85078ed5ac81cfe7c54e4fa555a612e5d4f17839a9a659824c88fe194d`
- Package files: `456`
- Package content bytes: `5538528`
- Controller: `@rpamis/comet@0.5.1`
- Platform: Windows x64
- Node.js: `24.21.0`

The tested implementation commit is the packaged-product boundary. Later commits may contain only
OpenSpec, Comet, or verification evidence. `check:managed-execution-report` independently rebuilds
the npm archive and rejects later packaged-product changes or semantic package drift.

## Distribution invariants proved

1. `Continuous integration / verify` runs for pull requests, `main` pushes, and manual dispatches
   with read-only repository permission and cancellation of obsolete runs for the same ref.
2. The CI job establishes one clean Node 24 environment with npm cache, executes `npm ci`, and then
   delegates all repository verification to the single `npm run verify` authority.
3. A structured workflow test rejects expanded top-level permissions, job-level permission
   overrides, a non-`main` push target, and copied internal checks, so the contract is not a YAML
   text snapshot.
4. The standalone `npm run test:package-e2e` entry point runs the standard build through npm
   lifecycle before packing, so it cannot silently consume a historical local `dist`.
5. Multi-repository acceptance defaults to a tarball installed in an isolated consumer directory
   and invoked through the installed public `bin`.
6. Direct-source diagnostics are an explicit exception. Every checkout update requires a current
   build and `node scripts/build.mjs --check` before the source CLI is invoked; an existing historical
   `dist/` is not evidence.
7. A GitHub check result and a required status check are separate authorities. Repository YAML can
   produce the stable check, while merge blocking remains an independently verified administrator
   configuration.

## Commands and results

Executed on Windows with Node.js `24.21.0`:

```text
npx vitest run test/repository-ci.test.ts
  1 file passed; 3 tests passed
  positive workflow contract, four in-memory mutation classes, and package script contract passed

npx vitest run test/self-hosting-docs.test.ts test/repository-ci.test.ts
  2 files passed; 6 tests passed
  package-first and direct-source command ordering passed

npm run test:package-e2e
  1 file passed; 1 test passed
  pretest lifecycle built CLI and Desktop first; current source was then packed, installed in an
  isolated consumer, and invoked through public bin

npm run lint
  passed

npm run typecheck
  passed

npx prettier --check .github/workflows/ci.yml test/repository-ci.test.ts \
  test/self-hosting-docs.test.ts docs/self-hosting.md package.json \
  openspec/changes/stabilize-cli-distribution-gate/{proposal.md,design.md,tasks.md} \
  openspec/changes/stabilize-cli-distribution-gate/specs/product-distribution/spec.md \
  docs/superpowers/plans/2026-11-05-stabilize-cli-distribution-gate.md
  all change-controlled files passed

node scripts/build.mjs --check
  passed; the source CLI bundle matches the current checkout

comet classic openspec -- validate stabilize-cli-distribution-gate --strict
  passed; the change is strictly valid

git diff --check
  passed

git status --short
  contained only the expected verification-report update before final evidence commit

npm run verify
  typecheck, Desktop typecheck, lint, and CLI/Desktop builds passed
  complete Vitest matrix passed: 191 files; 1 POSIX-only file skipped on Windows (192 total)
  946 tests passed; 3 explicitly skipped (949 total)
  generated, brand, architecture, provenance, and Dashboard salvage passed
  strict OpenSpec passed: 19 items, 0 failed
  managed execution report reproduced the package identity

```

The pre-report pass reached the final freshness gate and correctly requested this report. After the
report was refreshed outside the package boundary, the complete command was rerun and reproduced
the package identity shown above.

## Verify repair and controlled re-entry

The first independent Verify review found two IMPORTANT gaps and one WARNING: the standalone
package command did not build current sources, the original task text contradicted the approved
format-baseline exception, and a job-level permission override could bypass the workflow mutation
test. A direct-source documentation paragraph also contradicted the required freshness preflight.

Comet recorded the failed Verify and returned the same Run to Design. Proposal
`abdeb49d1d6e32fb00fe46c570b06f4da9122f84023b21b3f7c039c3a4da988f` was approved; the canonical
Design and existing task IDs were revised without changing the `product-distribution` delta spec.
The repair added RED tests for all three executable gaps, observed their expected failures, applied
the minimal implementation, and returned the focused suite to green before the package and static
checks above.

## OpenSpec verification scorecard

| Dimension    | Status                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| Completeness | Distribution 9/9 complete; cross-platform repair 13/13 with external evidence                           |
| Correctness  | Distribution 5/5 requirements implemented; repair declares `skip_specs` and preserves behavior contract |
| Coherence    | Approved revised Design followed; no new Runtime protocol or second recovery algorithm                  |

The first independent delta review of the distribution repair found 0 CRITICAL, 0 IMPORTANT, and 0
WARNING issues. It confirmed the standalone build lifecycle, task 3.1 baseline wording, job-level
permission rejection, direct-source freshness wording, and absence of Runtime, Cordis, launcher, or
protocol scope drift.

## Cross-platform Verify repair and second controlled re-entry

A later independent integration review found one IMPORTANT process-recovery gap: recovered POSIX
termination authorized `SIGKILL` with the leader creation identity, but then treated disappearance of
that leader PID as proof that its complete process group had stopped. A descendant could therefore
survive while the Runtime returned `terminated`. Comet recorded the failed Verify and returned the
same Run to Design; the revised proposal
`f08b444b5119b5b9b53b1fe69273c2fb4596735c4331d5bef329597b277fecab` was approved.

The repair retains creation identity solely as the pre-signal destructive-action authorization and
reuses the existing bounded process-group probe after the signal. `terminated` now requires
`kill(-pgid, 0)` to report `ESRCH`; group survival, permission ambiguity, and timeout remain
conservative `unknown` results. A deterministic fake-timer regression reproduced the old false
success, and a Comet-style detached parent/descendant fixture was added for real Linux execution.

The first complete Windows rerun correctly failed because the modified Comet-derived target digest
had not yet been refreshed. That provenance failure also caused the runtime-tracer E2E to reject the
same target digest. The single target entry in `third_party/comet/source-manifest.json` was updated;
`check:provenance` and the focused provenance/runtime-tracer set then passed 13/13, followed by the
complete Windows result recorded above. No source snapshot, upstream identity, or adoption class was
changed.

The first complete verification attempt ran from a new worktree whose local `node_modules` held
only Vite caches while Node resolved most dependencies from the parent repository. The Desktop E2E
correctly exposed that non-reproducible environment: its isolated CLI could not copy `yaml`, and the
source launcher could not find the pinned Electron executable. `npm ci` restored the locked local
dependency tree, the Electron package's official installer prepared its platform binary, and the
focused Desktop activation E2E passed 2/2 without product changes or weakened assertions.

An older Repoctopus Desktop single instance from a previous acceptance run also accepted the new
launch context and caused the test process to exit by design. The exact old process tree was stopped;
the focused E2E then proved real source startup, context forwarding, receiver discovery, process
shutdown, and continued remote OTLP export.

## Existing repository formatting baseline

The full `npm run format:check` reports 116 pre-existing files, including historical production
sources, archived OpenSpec documents, and Comet-generated state/handoff files. The implementation
base already contains those differences, and this change does not rewrite immutable archives or
machine-owned lifecycle state. Every file controlled by this change passes the exact Prettier check;
the full baseline failure remains visible rather than being silently ignored or misreported as green.
This is the pre-existing-baseline exception already declared in the approved Build plan for task 3.1;
`npm run lint` and `npm run typecheck` both exit 0.

## External evidence boundary

The branch is public and the workflow contract is locally validated. The GitHub-hosted Linux run
`42007557281` passed on exact report commit `5eba86870ba11d68773bc171d1cb2698466ca1f1` in 8m3s. Its
complete matrix passed 191 test files with 1 platform-skipped file: 945 tests passed and 4 were
explicitly skipped (949 total). The real `terminate-recovered-process-tree.integration.test.ts`
parent/descendant fixture ran on Linux and passed in 85ms. All 19 strict OpenSpec items and the
managed report identity also passed.

The independent post-repair review found 0 CRITICAL and no product-code issue. Its sole IMPORTANT
finding was that this report still listed a pre-repair Comet Build Check receipt as current evidence;
that stale command and receipt have been removed. The Runtime-owned Build Check is executed only
after the legal `build.execute` completion transition and is recorded in Comet state, so this report
does not predeclare or self-reference its future receipt. Whether the stable GitHub check is
configured as required remains an independently administered repository-rule fact.

## Cleanup

- The temporary npm archive used to compute the semantic package digest was deleted.
- Package E2E and Desktop activation fixture directories were removed by verified test hooks.
- The stale Repoctopus Desktop process tree from the previous acceptance run was terminated.
- No debug log, scratch JSON, package archive, launcher auto-build, tracked `dist`, Runtime change,
  daemon, webhook, or second verification authority was introduced.

## Verdict

The packaged implementation establishes a clean-checkout CI contract and a deterministic CLI
consumer boundary. The cross-platform repair removes the known false-success path without changing
the Repoctopus Runtime protocol. Local Windows verification, exact-report-commit GitHub Linux
verification, and independent post-repair review are complete. The Runtime may now leave Build
Execute, run its own input-bound Build Check, and continue to the formal Verify Guard.
