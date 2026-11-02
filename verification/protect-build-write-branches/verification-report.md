# Protected Build Write Branches Verification Report

## Reproducible subject

- Change: `protect-build-write-branches`
- Tested implementation commit: `ee38c39bbd352695adae4d9801d5d3d88ee77f53`
- Package: `repoctopus@0.1.0`
- Package files: `449`
- Package content bytes: `5301166`
- Package content SHA-256: `9cf3a861fda985c2c83913a8d36403f3d7553205257a9a5af993f51ea7a5066d`
- Controller reference: Comet `0.5.1` branch binding
- Platform: Windows x64
- Node.js: `24.21.0`

The tested implementation commit is the packaged-product boundary. Later commits may contain only tests, OpenSpec lifecycle state or verification evidence. `check:managed-execution-report` rejects later packaged-product changes and independently reconstructs the normalized npm package-content digest.

## Boundary invariants proved

1. Change Run trigger facts freeze normalized protected branch patterns and always include the resolved target branch.
2. Plan validation derives the writable repository set only from package write scopes. Read-only repositories may remain on a protected target branch.
3. A writable repository bound to `main`, `master`, `release/*` or another configured pattern rejects the Plan before terminal Outcome acceptance, Plan Evidence, Execute Work, claim, receipt or Task completion.
4. The rejection remains the existing generic `outcome-rejected` protocol with bounded Runtime diagnostic `change.build-plan-protected-branch`; no special lifecycle or Work schema was introduced.
5. After the Runner creates and publishes legal source branches, the next pull observes Execution Binding drift, retires the rejected Plan checkpoint and returns the same Run to Build Configure.
6. Build authorization and Delivery checkpoint use the same pure branch-pattern matcher for exact, `*` and `?` semantics.
7. Runtime never creates, switches, pushes or deletes Git branches/worktrees. Runner remains responsible for prepare-and-publish; Runtime observes and authorizes.
8. Protected plugin adoption lists only the exact direct predecessor implementation identities for WorkflowRuns, lifecycle definition, Delivery, WorkExecutionAuthority and ManagedWorkExecutor.

## Commands and results

```text
npm test -- --run test/protected-branch-policy.test.ts test/build-protocol-domain.test.ts test/change-lifecycle-domain.test.ts test/git-delivery.test.ts test/composition-compatibility.test.ts test/telemetry-mapping.test.ts
  6 test files passed; 70 tests passed

npx vitest run test/managed-change-execution.e2e.test.ts -t "in 'protected writable repositories" --reporter=verbose
  1 production-composition E2E passed; 4 unrelated cases skipped by filter
  The E2E proved main-bound write rejection, zero Execute/Task side effects, published source-branch recovery and same-Run Configure re-entry

npm run verify
  TypeScript, Desktop TypeScript, ESLint and CLI/Desktop builds passed
  176 test files and 813 tests passed; 2 skipped
  generated output, brand, architecture, provenance, Dashboard salvage and 18 strict OpenSpec items passed
  The report freshness gate alone rejected the older tested-commit boundary because two final test files were committed later

npx vitest run test/project-composition.test.ts
  1 test file passed; 1 test passed after updating the exact composition snapshot

npm run check:generated
npm run check:brand
npm run check:architecture
npm run check:provenance
npm run check:dashboard-salvage
npm run spec:validate
  All passed; strict OpenSpec validation passed 18 items with 0 failures
```

The report freshness gate is rerun after this evidence-only metadata update. It must independently reproduce the package identity above; no product or test change is allowed after the tested implementation commit.

## Telemetry and diagnostics

The durable rejection event records bounded `workKind=build.plan`, `reasonCode=outcome-rejected` and `continuation=awaiting-correction`. The RuntimeResult carries `change.build-plan-protected-branch` for immediate remediation. Repository ids, branch names, protected patterns, local paths and diagnostic text are not Metric labels; detailed branch context remains in local diagnostics only.

## Cleanup

- The temporary npm archive used to calculate the normalized package identity was deleted.
- The temporary plugin-identity tests used to capture direct predecessor digests were deleted from the main worktree, which was verified clean.
- Production E2E temporary repositories and bare remotes were removed by the fixture cleanup.
- No Runtime Store, checkpoint, approval or lifecycle state was edited to bypass a gate.

## Verdict

The implementation closes the highest-priority multi-repository write-safety gap before Execute authorization, preserves least privilege for read-only repositories and provides a same-Run recovery path aligned with Comet's fixed branch-binding principles while retaining Repoctopus multi-repository architecture.
