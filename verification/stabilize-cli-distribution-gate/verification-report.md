# CLI Distribution Gate Verification Report

## Reproducible subject

- Change: `stabilize-cli-distribution-gate`
- Tested implementation commit: `7ea2519ecd953ad6c90437a4bcaa06d50f13d7b7`
- Package: `repoctopus@0.1.0`
- Package content SHA-256: `7d9d126f322dfb6393beaa568462a366538976561550866798516fdf5b809570`
- Package files: `456`
- Package content bytes: `5538124`
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
3. A structured workflow test rejects expanded permissions, a non-`main` push target, and copied
   internal checks, so the contract is not a YAML text snapshot.
4. Multi-repository acceptance defaults to a tarball installed in an isolated consumer directory
   and invoked through the installed public `bin`.
5. Direct-source diagnostics are an explicit exception. Every checkout update requires a current
   build and `node scripts/build.mjs --check` before the source CLI is invoked; an existing historical
   `dist/` is not evidence.
6. A GitHub check result and a required status check are separate authorities. Repository YAML can
   produce the stable check, while merge blocking remains an independently verified administrator
   configuration.

## Commands and results

Executed on Windows with Node.js `24.21.0`:

```text
npx vitest run test/repository-ci.test.ts
  1 file passed; 2 tests passed
  positive workflow contract and three in-memory mutation classes passed

npx vitest run test/self-hosting-docs.test.ts test/repository-ci.test.ts
  2 files passed; 5 tests passed
  package-first and direct-source command ordering passed

npm run test:package-e2e
  1 file passed; 1 test passed
  current source was packed, installed in an isolated consumer, and invoked through public bin

npm run lint
  passed

npm run typecheck
  passed

npx prettier --check test/repository-ci.test.ts test/self-hosting-docs.test.ts \
  .github/workflows/ci.yml docs/self-hosting.md \
  openspec/changes/stabilize-cli-distribution-gate/tasks.md
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
  complete Vitest matrix passed: 190 files
  941 tests passed; 2 explicitly skipped (943 total)
  generated, brand, architecture, provenance, and Dashboard salvage passed
  strict OpenSpec passed: 18 items, 0 failed
  managed execution report reproduced the package identity
```

The pre-report pass reached the final freshness gate and correctly requested this report. After the
report was created outside the package boundary, the complete command was rerun and exited 0 with
the same 190-file/943-test result and reproduced package identity.

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

The branch is public and the workflow contract is locally validated. A GitHub-hosted
`Continuous integration / verify` result has not yet been observed for the final branch commit and
is therefore not claimed here. Whether that check is configured as required must be verified from
GitHub branch rules by a repository administrator.

## Cleanup

- The temporary npm archive used to compute the semantic package digest was deleted.
- Package E2E and Desktop activation fixture directories were removed by verified test hooks.
- The stale Repoctopus Desktop process tree from the previous acceptance run was terminated.
- No debug log, scratch JSON, package archive, launcher auto-build, tracked `dist`, Runtime change,
  daemon, webhook, or second verification authority was introduced.

## Verdict

The packaged implementation establishes a clean-checkout CI contract and a deterministic CLI
consumer boundary without changing Repoctopus Runtime semantics. The remaining lifecycle work is to
reproduce this report's package identity, complete Comet Build Check and Verify, observe the first
GitHub-hosted check, and archive the OpenSpec change.
