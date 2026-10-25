# Single-Run Change Lifecycle Verification Report

## Reproducible subject

- Change: `adopt-comet-single-run-lifecycle`
- Tested implementation commit: `c96509d20a9f013aed77f70f037d080610c1f6f3`
- Package: `repoctopus@0.1.0`
- Package bytes: `952389`
- Package SHA-256: `ab0c91f8f4d86e28bc8b527c461b0f746db89d6d15b92d6e0c8052719194b487`
- Lifecycle definition: `repoctopus-change@3.0.0`
- Lifecycle definition digest: `sha256:42eebeda8add66e967021c322a765aa9052797c07e3f526f7322cdecc4e4e7d9`
- Composition digest: `sha256:0f52306c5478580e72a9618918ebcdb11a13b1ca5a310cbef9bf3722e2488b69`
- Self-bootstrap runId: `change-repoctopus-adopt-comet-single-run-lifecycle-1784ada21df4159c`

The implementation commit is the package boundary. Later commits may contain only OpenSpec or verification evidence and the report checker itself; any other product change invalidates this report. The package checksum is independently reproduced by `npm pack`.

## Verification commands

Run on Windows with Node.js `24.21.0`:

```text
npm run verify
  typecheck, desktop typecheck, lint and both builds passed
  120 test files passed
  451 tests passed, 1 skipped
  generated, brand, architecture and provenance checks passed
  OpenSpec strict validation: 15 passed, 0 failed

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

## Anti-cheating sensitivity

The acceptance suite fails independently if any of these regressions is reintroduced: lifecycle generation or mode identity, automatic Open advancement, missing Design approval, Host-selected target phase, Build design-skill duplication, Verify fallback without managed Repair Work, cross-epoch Outcome acceptance, or duplicate current Dashboard cards. OpenSpec authority fixtures also reject missing four-artifact output, environment facts delegated to the user, a fifth planning document and a Design packet that replaces rather than deepens the approved Open baseline.

## Verdict

All 42 tracked tasks are implemented. The lifecycle is pull-based, Runtime-authoritative, Host-mediated and recoverable from persisted boundaries. One stable Run owns Open, Design, Build, Verify and Archive; `stateVersion`, `checkEpoch`, Work attempt and trajectory sequence retain separate responsibilities. Legacy generation data remains read-only audit material and is excluded from current locators and journals.
