# OpenSpec Store Root Bootstrap Verification Report

## Reproducible subject

- Change: `bootstrap-openspec-store-root`
- Tested implementation commit: `25e2fadaaa860522cbbecb8bb23975b86f940be0`
- Package: `repoctopus@0.1.0`
- Package content SHA-256: `5d941cd02b3b5c1d6171c16d102dce56051ed0c8ab3551edde2f0e563490b5cc`
- Package files: `449`
- Package content bytes: `5359911`
- Controller: `@rpamis/comet@0.5.1`
- OpenSpec Provider: `@fission-ai/openspec@1.14.3`
- Platform: Windows x64
- Node.js: `24.21.0`

The tested implementation commit is the packaged-product boundary. Later commits may contain only OpenSpec, Comet, plan, or verification evidence. `check:managed-execution-report` independently rebuilds the npm package and rejects later packaged-product changes or semantic package drift.

## Invariants proved

1. A fresh, non-empty Git Workspace with no `openspec/` is classified as `missing-root`; Repoctopus never sends it directly to `openspec store register`.
2. Root materialization uses the fixed installed OpenSpec package entry and exact argv `init <workspace> --tools none --profile custom --language zh-CN --no-animation --no-copilot-cloud`. Repoctopus does not handwrite Provider-owned root files.
3. Root observation distinguishes exact registration, healthy unregistered root, missing root, partial or unhealthy root, and registration conflict. The approved Provider version, Workspace, Store identity, root evidence, and initialization argv participate in stable transaction identity.
4. The onboarding transaction is ordered `prepare-root -> register-store -> business pointers -> repoctopus.yaml`. Any earlier failure prevents later publication.
5. Every side effect is preceded by a request-scoped immutable Intent and followed by a Receipt. A lost initializer result can be recovered only for the same approved request and exact official initializer footprint; unexpected files, symlinks, partial roots, identity drift, and Store conflicts fail closed without deletion or overwrite.
6. Registration occurs only after an exact healthy-root observation and is followed by explicit Store context re-observation. A nearest parent root, same Store id in another checkout, metadata mismatch, malformed registry output, and context mismatch are not accepted.
7. OpenSpec CLI integration tests use temporary `XDG_DATA_HOME` and `XDG_CONFIG_HOME`; the developer registry content and timestamp remain unchanged.
8. OpenSpec process results distinguish caller abort, timeout, ordinary non-zero exit, output limit, and spawn failure instead of collapsing infrastructure failures into an untyped exception.

## Real multi-repository acceptance

The production CLI fixture creates a fresh coordinating Workspace and a sibling business repository. It completes project detection and the trusted Human Decision, initializes the Workspace OpenSpec root, registers the Store, installs the business-repository pointer, and publishes `repoctopus.yaml` last.

The fixture then creates proposal, design, tasks, and delta-spec artifacts for a minimal Change in the registered Store. Strict OpenSpec validation passes. A second cold OpenSpec process resolves the same explicit Store, while the business repository continues to consume the pointer without copying the specification authority.

Recovery coverage includes interruption after Root Intent and after official initialization but before Receipt, plus an existing historical register Intent without a Receipt. Retry continues the same request transaction and does not repeat an already proved side effect.

## Commands and results

Executed on Windows with Node.js `24.21.0`:

```text
npm run verify
  typecheck, Desktop typecheck, lint, CLI/Desktop builds passed
  179 test files passed
  834 tests passed; 2 skipped
  generated output, brand, architecture, provenance and Dashboard salvage passed
  19 strict OpenSpec items passed; 0 failed
  pre-report freshness gate correctly requested this report

npx vitest run test/store-binding.test.ts test/openspec-process.test.ts
  test/openspec-store-registration.test.ts test/project-onboarding.test.ts
  test/project-detection.test.ts test/e2e/project-onboarding-flow.e2e.test.ts
  Store transaction, real CLI, interruption recovery and cold-process acceptance passed

npx openspec validate bootstrap-openspec-store-root --strict
  Change 'bootstrap-openspec-store-root' is valid

npm run check:architecture
  283 production sources and 21 capability owners verified

npm run check:provenance
  20 Comet-derived files, 60 immutable Cordis files, 33 Matt Skill files,
  8 fixed DSH packages, and 5 DSH Desktop references verified
```

## Comet adoption boundary

Repoctopus adopts Comet 0.5.1's mature transaction principles: immutable intent before mutation, observation-based recovery after an unknown external result, exact identity binding, and fail-closed continuation. It does not copy Comet source, import its single-repository lifecycle state, or create a second generation/checkpoint system. The implementation remains native to Repoctopus's OpenSpec Store and multi-repository pointer architecture.

## Cleanup

- The isolated OpenSpec registries and simulated repositories were removed by their test fixtures.
- The temporary npm package archive and its verified directory were deleted after computing the semantic package digest.
- No real OpenSpec Store registry, Runtime Store, Intent, Receipt, or checkpoint was edited to force success.
- No debug log, scratch JSON, package archive, temporary Workspace, webhook, daemon, or compatibility branch remains.

## Verdict

The packaged implementation fixes the reported fresh-company-Workspace failure without weakening Store identity, multi-repository authority, or recovery safety. Root creation, registration, pointer publication, cold-process consumption, interruption recovery, package identity, architecture, provenance, and strict specification checks pass. The remaining lifecycle work is to reproduce this report checksum, complete Comet Build Check and Verify, and archive the approved Change.
