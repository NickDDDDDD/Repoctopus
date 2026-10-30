# Upstream Baseline Refresh Verification Report

## Reproducible subject

- Change: `refresh-upstream-baselines-2026-10-30`
- Branch: `codex/refresh-upstream-baselines-2026-10-30`
- Tested implementation commit: `94000524dd651ad80615665478fab0a53e763ebf`
- Package: `repoctopus@0.1.0`
- Package bytes: `941895`
- Package SHA-256: `f36414d2b9a6c0241ed2da50aeb23661c1338c67a550617fa6b31653ab2c3702`
- Platform: Windows x64
- Node.js: `24.21.0`
- Verification date: 2026-10-30

The implementation commit is the packaged product boundary. Later report, OpenSpec state, and verification-only commits do not alter package bytes. Any later packaged source change invalidates this report through `check:managed-execution-report`.

## Upstream identities

| Upstream | Adopted release   | Adopted commit                             | Audited branch commit                      |
| -------- | ----------------- | ------------------------------------------ | ------------------------------------------ |
| DSH      | `dsh-v0.2.1-rc.5` | `b830ec950faba0a46dda564be3e2d854afed94f1` | `ce7073d51254c26cd63b22a60835b8f948deb447` |
| Comet    | `0.5.1`           | `35c9860b77b42bafa0c2d80d8d695889f888a924` | `4901cac9330f5ffe289abfa6daf8412bfa190dc0` |

Both release commits are ancestors of their audited branch commits. DSH and Comet remain MIT licensed; release-to-release license digests did not change.

## Behavior and provenance verified

1. Upstream baseline schema v2 separates `auditedBranchCommit` from `pinnedTagCommit` and rejects the ambiguous schema v1 contract.
2. Daily drift checks compare branch and tag identities independently; a moved tag and an advanced branch both fail.
3. Provenance binds DSH, Cordis and Comet sources only to immutable release commits. Changing only an audited branch commit does not change adopted source identity.
4. All eight direct DSH packages resolve exactly to `0.2.1-rc.5`; package overrides and lockfile prevent transitive range drift.
5. DSH rc.3→rc.5 leaves adopted Skill, Filesystem Skill, Cordis and Loader behavior bytes unchanged. The registered desktop package reference digest is refreshed.
6. Comet's 20 registered sources were recalculated from a detached 0.5.1 worktree. Only Native lock and Classic command-check sources changed; every Repoctopus target digest stayed unchanged.
7. DSH and Comet branch-tail changes are documented as adopt, reject or defer decisions and did not silently modify Runtime behavior.

## Command evidence

| Command                                                                        | Exit | Result                                                                                                         |
| ------------------------------------------------------------------------------ | ---: | -------------------------------------------------------------------------------------------------------------- |
| `npm exec -- openspec validate refresh-upstream-baselines-2026-10-30 --strict` |    0 | Change valid; official `skip_specs` INFO accepted for a no-delta maintenance Change                            |
| `npm run check:upstream`                                                       |    0 | DSH and Comet branch/release identities current                                                                |
| `npm run check:provenance`                                                     |    0 | 20 Comet files, 60 Cordis files, 33 Matt Skill files, 8 DSH packages and 5 desktop references verified         |
| `COMET_UPSTREAM_ROOT=<detached-0.5.1> npm run check:provenance`                |    0 | Every registered Comet source digest matched fixed worktree bytes                                              |
| `npm ls <eight DSH packages> --depth=0`                                        |    0 | All eight packages resolved to exact rc.5                                                                      |
| `npm audit --omit=dev --audit-level=high`                                      |    0 | 0 vulnerabilities                                                                                              |
| `npm audit --audit-level=high`                                                 |    0 | 0 vulnerabilities                                                                                              |
| `npm run check:architecture`                                                   |    0 | 260 production sources, 21 capability owners and protected boundaries verified                                 |
| `npx vitest run test/upstream-drift.test.ts test/provenance.test.ts`           |    0 | 17 focused tests passed                                                                                        |
| `npm run verify` (first pass)                                                  |    1 | All product checks and 568 tests passed; final gate correctly rejected the stale package report                |
| `npm run verify` (final pass)                                                  |    0 | 142 files, 568 tests passed and 2 skipped; all build, governance, provenance, OpenSpec and report gates passed |

The first pass demonstrated that packaged product changes cannot reuse stale Evidence. After the report was bound to the tested implementation commit and package checksum above, the complete second pass succeeded.

## Final remote observation

At `2026-10-30T12:27:21+08:00`, a fresh `git ls-remote` returned the same frozen identities:

- DSH `master`: `ce7073d51254c26cd63b22a60835b8f948deb447`
- DSH `dsh-v0.2.1-rc.5`: `b830ec950faba0a46dda564be3e2d854afed94f1`
- Comet `master`: `4901cac9330f5ffe289abfa6daf8412bfa190dc0`
- Comet `0.5.1`: `35c9860b77b42bafa0c2d80d8d695889f888a924`

No new upstream drift occurred during implementation or verification.

## Cleanup evidence

- The detached Comet 0.5.1 worktree was removed through `git worktree remove --force` after its exact temporary path was verified.
- The verified audit root `repoctopus-upstream-audit-48715f0b424149fa879d6c2e8da87efd`, npm tarballs and extracted package checks were moved to the Windows Recycle Bin after recursive `Remove-Item` was denied by host policy.
- The manually generated `repoctopus-0.1.0.tgz` and `repoctopus-pack-result.json` were moved to the Recycle Bin.
- Post-cleanup `Test-Path` returned `False` for every named target. The operations are recoverable from the Recycle Bin.

## Environmental observations

- The first long Comet temporary path could not expand deep archived Evidence paths on Windows. A shorter temporary root produced a complete detached 0.5.1 worktree and the same provenance check passed.
- The first Comet clone was object-complete but had no expanded working tree; source hashes obtained through `git show` were independently rechecked through the detached worktree file reader.
- These are audit-environment constraints, not product Runtime failures, and no check was disabled or downgraded.

## Scope boundary

This Change updates baselines, dependencies, provenance checks, tests and audit documentation only. It does not implement the separately recorded frozen Work packet, OpenSpec skip-specs Gate or Provider diagnostic-severity fixes. Those remain inputs to the next core workflow reliability Specification Change.
