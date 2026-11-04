# Archive Publication Recovery Verification Report

## Reproducible subject

- Change: `stabilize-archive-publication-recovery`
- Tested implementation commit: `c39fbe01d10bb0b290ef8a645ca6f847b12f9085`
- Package: `repoctopus@0.1.0`
- Package content SHA-256: `842f47f170ca63c30f3be3f941b4f3f0670ad62bb9de93d31cfbc4e0ed7de347`
- Package files: `451`
- Package content bytes: `5421479`
- Controller: `@rpamis/comet@0.5.1`
- Platform: Windows x64
- Node.js: `24.21.0`

The tested implementation commit is the packaged-product and frozen acceptance-fixture boundary.
Later commits may contain only OpenSpec, Comet, or verification evidence.
`check:managed-execution-report` independently rebuilds the npm archive and rejects later packaged
product changes or semantic package drift.

## Runtime invariants proved

1. GitHub create rejections with an explicit HTTP 4xx are classified as `not-applied`.
   HTTP 5xx, transport failure, successful invalid JSON, and post-create status verification
   failure remain `unknown`.
2. A not-applied create ends the current pull and atomically returns the same Business or
   Specification Journal operation to `pushed`. It retains the intent, operation identity,
   published OID, and attempt history.
3. The next explicit pull observes first and may create once. An unknown operation is
   observation-only; repeated recovery never increments create count.
4. A unique exact repository/head/base/head-OID match completes as `recovered`. Zero matches,
   ambiguity, and OID mismatch remain fail-closed.
5. Only `PublicationResultUnknownError` marks Work execution as external-side-effect unknown.
   `PublicationNotAppliedError` retains the same validated Archive Work as retryable and records a
   bounded reconciliation fact.
6. A completed Run always projects `done/terminal`, null Work and attempt, the current check epoch,
   and no next action. Historical null-Work selections cannot override terminal authority.
7. Non-terminal continuation replay requires exact Run, state version, Work, attempt, and check
   epoch identity.
8. Publication telemetry exposes only bounded stage, certainty, and result dimensions. Repository,
   branch, path, response body, and free error text do not enter Metric labels.
9. The `delivery-file` composition identity includes the full publication recovery implementation,
   persistence adapter, and GitHub platform adapter.

## Historical and fresh acceptance evidence

The portable fixture
`test/fixtures/archive-publication-round5-terminal.json` freezes the fifth-round production shape:
a completed Archive checkpoint followed by an older null-Work `continuation.selected` fact. The
public projector replays it as terminal only and produces no next action.

The failure-injection matrix uses fake platform adapters and local Git repositories. It proves one
not-applied failure followed by a corrected explicit pull, unknown create without replay, later
exact adoption, Specification publication parity, stable operation identity, and post-create
verification fail-closed behavior. No test contacts GitHub or creates a real MR.

The packaged CLI E2E uses the production build and a temporary local Workspace. It verifies that
the packaged entrypoint remains runnable with the repaired composition and generated artifacts.

## Commands and results

Executed on Windows with Node.js `24.21.0`:

```text
npx vitest run test/change-continuation.test.ts test/github-merge-request.test.ts \
  test/resumable-publication.test.ts test/stable-publication.test.ts \
  test/specification-publication.test.ts test/telemetry-mapping.test.ts
  6 files passed; 51 tests passed

npm run test:package-e2e
  packaged CLI E2E passed: 1 file, 1 test

npm run verify
  TypeScript, Desktop TypeScript, ESLint, CLI/Desktop production builds passed
  complete Vitest matrix passed: 182 files, 861 tests; 2 explicitly skipped
  generated, brand, architecture, provenance, and Dashboard salvage passed
  strict OpenSpec passed: 18 items, 0 failed
  managed execution report reproduced the package identity
```

The first complete verification pass found one deterministic composition digest snapshot after the
new recovery code. Review showed the underlying source manifest also omitted publication recovery
dependencies. The manifest was completed before updating the fixture; the focused composition,
architecture, provenance, and generated-artifact checks then passed.

## Recovery diagnostics and telemetry

Not-applied diagnostics instruct the operator to correct the bounded platform rejection and pull
the same Archive Work. Unknown diagnostics instruct exact observation/adoption or reconciliation
with authoritative not-executed evidence. Neither path recommends a new Run, Store edits, or blind
create replay.

Trace events preserve the existing Run, Work, attempt, and check-epoch correlation. Metrics add
only `push|merge-request`, `not-applied|unknown`, and `retryable|reconcile`; privacy tests reject
repository, branch, path, and error-body labels.

## Cleanup

- The temporary npm package archive used for the semantic digest was deleted.
- Local Git and packaged CLI fixture directories are removed by verified test hooks.
- The temporary `node_modules` junction used by this isolated worktree is removed during final
  cleanup after all verification commands.
- No debug log, scratch JSON, real MR, Runtime Store edit, compatibility reader, daemon, webhook,
  merge wait, or auto-merge path was introduced.

## Verdict

The packaged implementation restores deterministic Archive publication recovery and terminal
projection while preserving pull-based Runtime authority. It follows Comet's external-effect rule:
unknown results are never replayed, and retry becomes legal only after definite not-execution. The
remaining lifecycle work is to reproduce this report checksum, complete Comet Verify, remove the
temporary dependency junction, and archive the OpenSpec Change.
