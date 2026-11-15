# Specification validation authority

Tested implementation commit: `9b19e3f72bf6d2283c74fc1af97dec6090149473`

Package content SHA-256: `72b2cc877951f8aedaa5026ff75b17752a23a5798820beeb3571d5cb1e135fcc`

Package files: `487`

Package content bytes: `6522103`

## Before and after

The earlier installed candidate wrote an invalid OpenSpec validation to the Run. Correcting the draft changed its validation digest, then the earlier binding rejected the next valid validation. A separate comparison with the same earlier candidate showed that validating a different Change succeeded and advanced the original Run from state version 15 to 16.

The current CLI checks the Run's Workspace and Change before consulting the provider. The Windows CLI regression checks an invalid response, two different valid drafts, and a different Change. Each query preserves the Run, checkpoint and trajectory bytes. It also verifies that a manually interrupted journal remains pending after a validation query.

The Runtime commits the valid Phase validation snapshot and the accepted Open or Design transition through the same guarded operation. Provider failure before the commit, stale phase and approval facts, and concurrent equivalent submissions are covered in focused tests. An unavailable observation preserves the current Work and accepted facts. Confirmed semantic or approval changes follow the existing Design recovery. A live OpenSpec Store reporting a missing Change produces a deterministic observation, distinct from a transport error.

## Installed Windows candidate

Built the CLI and desktop assets, packed the candidate, and installed the actual archive with npm in an isolated directory. Transport SHA-256 is `cdc4b4beb79be346fd77320f3776a242fb69d86faf87a870e528cb69fba5a9c0`. The [machine-readable acceptance receipt](acceptance-receipt.json) binds the installed package to the actual CLI Run and its execution counts.

The five-repository experiment used an independent Workspace and two business marker changes, with the other two repositories attached for topology. Open validation failed on the deliberate delta issue without a write, then succeeded after restoring the draft. A fresh CLI process returned to the same Open invocation. The independent Design accepted a different valid digest. The Build ran two TDD packages, and a cold resume after the first preserved its completion. Both machine Verify commands passed once. Committing Runtime-owned task checkboxes preserved the accepted Plan, bundle and Verify attempt.

## Review and checks

- Independent integration review covered query ownership, guarded Phase acceptance, definitive versus unavailable observations, and the original Verify/Archive execution. The review found preflight ordering and Verify recovery gaps. Those findings were fixed and rechecked against `b593cfc` and `403015e`.
- The isolated Build Check standards and specification reviews verified the same two source commits, their precise write scopes, and the RED, GREEN and regression command receipts. Each axis found zero blockers.
- All 126 targeted tests passed in eight files. The managed derived-output matrix passed independently with real CLI cold recovery, a Provider outage before Build dispatch and Archive effects, and a foreign Archive intent rejected before a Run write. Type checking, lint, architecture, generated artifacts and strict OpenSpec validation passed.
- The complete configured check runs as the Comet Verify Guard command `npm.cmd run verify`. Its receipt records the overall result.

The earlier damaged Run was retained as reproduction evidence. The installed acceptance started a fresh Run, then resumed that same Run through Archive. All three experimental PRs target the isolated acceptance branch. Product delivery and Release are separate from this experiment.

## Final package and Verify recovery

The first full Verify identified a stale Comet adoption checksum for the updated runtime file and a missing Windows Electron binary. The manifest now attests the exact committed source. The pinned Electron binary was prepared through the existing `npm run desktop:prepare` command. Focused provenance, installed-package, runtime tracer and desktop activation tests passed.

The complete five-repository run used the earlier archive described above. The final archive has transport SHA-256 `d1d522a17b7e9d5b2a2fa027c0558424d89d7609aa90092043a1f34619639e86`. Across both installed archives, 486 of 487 files are byte-identical, including the Runtime bundle and Skills. The sole difference is the attestation in `third_party/comet/source-manifest.json`. The final package passed `doctor --run` and the four terminal recovery assertions with the same report, check counts and PRs. The [acceptance receipt](acceptance-receipt.json) records this comparison.
