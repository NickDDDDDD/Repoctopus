# Single-Run Change Lifecycle Verification Report

## Reproducible subject

- Change: `adopt-comet-single-run-lifecycle`
- Tested implementation commit: `a539c8d47b60ec41dcc028b45c4e38d2991f1357`
- Package: `repoctopus@0.1.0`
- Package bytes: `986869`
- Package SHA-256: `a22acbc5d240e82965a611e81123248c3a3385e84e79000c5f8ef53248f2960c`
- Lifecycle definition: `repoctopus-change@3.0.0`
- Lifecycle definition digest: `sha256:d45fdabde20f79ccc9e0dd95ce164d5b7225ce736b1e76e08c44e53e85c92a0e`
- Verified input composition digest: `sha256:0f52306c5478580e72a9618918ebcdb11a13b1ca5a310cbef9bf3722e2488b69`
- Self-bootstrap runId: `change-repoctopus-adopt-comet-single-run-lifecycle-1784ada21df4159c`

The implementation commit is the package boundary. Later commits may contain only OpenSpec or verification evidence and the report checker itself; any other product change invalidates this report. The package checksum is independently reproduced by `npm pack`.

## Verification commands

Run on Windows with Node.js `24.21.0`:

```text
npm run verify
  typecheck, desktop typecheck, lint and both builds passed
  125 test files passed
  484 tests passed, 1 skipped
  generated, brand, architecture and provenance checks passed
  OpenSpec strict validation: 14 passed, 0 failed

npm run test:package-e2e
  1 test file passed, 1 test passed

npm run test:tracer-e2e
  1 test file passed, 1 test passed

npm audit --omit=dev --audit-level=high
  0 vulnerabilities
```

## Runtime acceptance evidence

The real repository self-bootstrap uses the stable runId above. Open delivered `repoctopus-open-change` plus `grilling`, validated the same four OpenSpec artifact classes, and stopped at an Open Human Decision. After approval, Design delivered `repoctopus-design-change` plus `codebase-design`, deepened the same four artifacts, and stopped at a separate Design Human Decision. Build imported all 42 pre-existing completion claims only after a third, same-Run `adopt-existing` decision; the import does not synthesize either planning approval and does not skip Verify.

The complete packaged-CLI single- and multi-repository journeys are exercised by `test/managed-change-execution.e2e.test.ts`, `test/e2e/change-design-gate-cli.e2e.test.ts`, `test/e2e/change-run-cli.e2e.test.ts`, archive publication suites and recovery suites. They restart process boundaries, inject implementation retry, Build-to-Design, Verify repair, planning drift, infrastructure retry, Archive reverify, response loss and OID drift while asserting one runId and monotonically increasing `checkEpoch`.

Follow-up telemetry regression coverage now persists Validator start/completion boundaries around every lifecycle Validator invocation. Controlled-time tests prove non-zero Run, Validator, Evidence Attempt and Evidence Node spans, and derive identity-free phase residency, active execution, human/external wait, rework, retry, unknown, reconcile and recovery metrics from durable facts. Metric dimensions remain fixed enums; Work, Task, Validator and operation identities stay in correlated Log/Span attributes only.

The self-bootstrap Archive exposed an incorrect frozen Change branch OID before any remote publication. The regression repair now performs the planning/live-remote check before creating closure Work and repeats it before push/MR. Tests prove that an isolated closure can rebind only an OID jointly established by the live source branch and closure candidate; if the live branch has advanced, the same Run invalidates the local closure and returns to Design instead of publishing unverified code. Protected plugin recovery is limited to an exact predecessor `codeDigest + descriptorDigest` declaration with unchanged authority, state schema and effective config. Lifecycle-definition recovery is separately limited to an explicitly listed predecessor definition digest; a compatible upgrade may restore an interrupted Archive publication by creating a fresh Work at a new `checkEpoch`, but it cannot reuse the cleared Work or its Outcome. If the semantic `workId` is stable across epochs, the claim must use a higher attempt and execution authority distinguishes the new instance by `workId + checkEpoch`; an orphaned Action Intent that never reached the Run checkpoint may safely leave an attempt gap.

## Anti-cheating sensitivity

The acceptance suite fails independently if any of these regressions is reintroduced: lifecycle generation or mode identity, automatic Open advancement, missing Design approval, Host-selected target phase, Build design-skill duplication, Verify fallback without managed Repair Work, cross-epoch Outcome acceptance, or duplicate current Dashboard cards. OpenSpec authority fixtures also reject missing four-artifact output, environment facts delegated to the user, a fifth planning document and a Design packet that replaces rather than deepens the approved Open baseline.

## Verdict

All 42 tracked tasks are implemented. The lifecycle is pull-based, Runtime-authoritative, Host-mediated and recoverable from persisted boundaries. One stable Run owns Open, Design, Build, Verify and Archive; `stateVersion`, `checkEpoch`, Work attempt and trajectory sequence retain separate responsibilities. Legacy generation data remains read-only audit material and is excluded from current locators and journals.
