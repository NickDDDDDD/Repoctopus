# Cross-Platform Verification Stability Report

## Reproducible subject

- Change: `stabilize-cross-platform-verification`
- Tested implementation commit: `8323dca53d94a689ac177645284d7c0520aacd93`
- Package: `repoctopus@0.1.0`
- Package content SHA-256: `298258e55caf72594910f70b453046ea01b873dd1f902f6481b3283973b50b2c`
- Package files: `456`
- Package content bytes: `5539499`
- Controller: `@rpamis/comet@0.5.1`
- Platform: Windows x64
- Node.js: `24.21.0`

The tested implementation commit is the packaged-product boundary. Later commits may contain only
OpenSpec, Comet, or verification evidence. `check:managed-execution-report` independently rebuilds
the npm archive and rejects later packaged-product changes or semantic package drift.

## Invariants proved

1. `ExecutionWorkspaceBinding` still accepts only absolute paths in the current Runner's host path
   semantics. Tests use a host-native virtual path factory instead of weakening production
   validation to accept paths that the Runner cannot access.
2. Windows Desktop receiver discovery uses `path.win32` for `LOCALAPPDATA`, override validation,
   normalization, and joining. This makes the Windows contract testable on Linux without claiming
   Linux Desktop support.
3. POSIX recovered process termination does not report `terminated` merely because `SIGKILL` was
   sent. It polls the recorded process ownership for a bounded interval and reports success only
   after `not_running`; a matched, unknown, or unverifiable process remains conservative.
4. The Windows `taskkill.exe /pid /t /f` path and ownership gate remain unchanged.
5. Composition and Comet target provenance identities were refreshed because their governed target
   bytes changed; fixed upstream source identities remain unchanged.
6. Semantic npm package identity binds entry path, type, byte length, byte digest, and link target,
   while excluding host-derived tar mode bits alongside the other transport metadata. The tar mode
   field is still parsed and validated, but Windows `0644` and POSIX `0755` presentations of the
   same package bytes no longer produce different product identities.

## TDD evidence

The POSIX regression test first failed with:

```text
expected 'terminated' to be 'unknown'
```

after the mocked operating-system boundary kept ownership in `matched` through the full deadline.
The minimal implementation added bounded ownership confirmation; the same two tests then passed.

The package identity regression test then constructed two archives with identical entry bytes and
different host modes (`0644` and `0755`). It first failed with distinct SHA-256 values. Removing the
mode from the canonical content entry and advancing the identity domain to v2 made the two package
identities equal without weakening content, path, entry-type, or link-target binding.

PR #66's GitHub Linux run supplied the original RED evidence for host-native checkout fixtures and
Windows discovery: fixed `C:\\...` checkout paths failed Linux `path.isAbsolute()`, and Windows
`LOCALAPPDATA` was rejected by the host POSIX `node:path` implementation. Windows itself cannot
reproduce that host-semantic mismatch, so the regression assertions preserve the cross-host
contract and the new Linux run is the final GREEN authority.

## Commands and results

Executed on Windows with Node.js `24.21.0`:

```text
npx vitest run <10 affected test files>
  10 files passed
  95 tests passed; 1 explicitly skipped (96 total)

npm run typecheck
  passed

npm run lint
  passed

npm run spec:validate
  19 strict OpenSpec items passed; 0 failed

npx vitest run test/project-composition.test.ts test/provenance.test.ts \
  test/e2e/runtime-tracer.e2e.test.ts
  3 files passed; 14 tests passed

npm run check:provenance
  verified 20 Comet-derived files, 60 immutable Cordis files, 33 Matt Skill files,
  8 fixed DSH packages, and 5 DSH Desktop references

npm run verify (pre-report pass)
  typecheck, Desktop typecheck, lint, and CLI/Desktop builds passed
  complete Vitest matrix passed: 191 files
  945 tests passed; 2 explicitly skipped (947 total)
  generated, brand, architecture, provenance, Dashboard salvage passed
  strict OpenSpec passed: 19 items, 0 failed
  final managed-execution-report freshness gate correctly requested this report
```

The first complete pass exposed stale derived identities for the changed Desktop plugin composition
and Comet-derived process adapter target. Their focused tests failed deterministically. The target
manifest digest and exact composition identity were refreshed, while the upstream source digest
remained fixed; the three affected files then passed 14/14 and the independent provenance command
passed.

The first GitHub Linux pass then executed the full matrix successfully (190 passed files, one
platform-skipped file; 943 passed tests and 4 Windows-only skips) but the final report checker could
not prove this report's implementation commit was an ancestor in `actions/checkout`'s default
depth-one clone. A workflow contract test first failed with `full-history-checkout`; setting
`fetch-depth: 0` made the contract pass 3/3. The npm package digest did not change because workflow
and test sources are outside the published package, but this report advances the tested commit to
the new CI/test authority boundary.

With full history available, the next GitHub Linux pass again completed all 190 runnable test files
and 943 tests, then exposed the remaining platform-dependent input in the report gate: npm archive
mode bits. Linux and Windows produced the same 456 paths and 5,539,499 content bytes but different
v1 digests. The focused mode regression test and the v2 content identity above remove that host
metadata from the package boundary. The next exact-HEAD Linux run remains the GREEN authority.

## External Linux evidence boundary

The branch is public and every implementation commit was pushed immediately. GitHub Linux `verify`
for PR #66 must now succeed against the exact full-history workflow/report HEAD before task 4.3 or
this change can be considered complete. A local Windows result does not substitute for that clean
checkout, and a successful workflow is reported separately from repository required-check policy.

## Cleanup

- The npm archive used to compute the semantic package digest was deleted after reading it.
- Managed service tests clean their temporary workspaces and child processes through verified hooks.
- No debug log, scratch JSON, package archive, local absolute path, daemon, webhook, or second
  verification authority remains in the worktree.

## Verdict

The implementation satisfies the approved cross-platform design and passes all local product,
architecture, provenance, and specification checks up to the expected report-freshness gate. The
remaining evidence is to reproduce this package identity with the report present and observe the
GitHub Linux `verify` check on the exact pushed HEAD.
