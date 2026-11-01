# Runtime Telemetry Measurements Verification Report

## Reproducible subject

- Change: `integrate-runtime-telemetry-measurements`
- Tested implementation commit: `90bdacf9bc9d8e1bdf4c8f484b2e4fc79002cb4b`
- Core packaged implementation commit: `d345063a0e2e0dd4c90926498017fb1014f21a76`
- Package: `repoctopus@0.1.0`
- Package bytes: `1107246`
- Package SHA-256: `f2dc6257a7cd1e4936ad8f31e4195f4c8542c19d7717fca24e8d19f619bcb37c`
- Controller: `@rpamis/comet@0.5.1`
- Platform: Windows x64
- Node.js: `24.21.0`
- Telemetry schema: `1`

The tested implementation commit is the packaged-product boundary. Later commits may contain only OpenSpec state or verification evidence. `check:managed-execution-report` rejects later packaged-product changes and independently reproduces the package checksum.

## Verdict

Repoctopus now exposes one generated, versioned telemetry contract and sends Desktop and remote SigNoz/Collector destinations through the same canonical observation envelope, outbox, OTLP projection, Resource configuration, and replay cursor. The product supports standard unified and per-signal OTLP endpoint, header, timeout, service-name, and Resource-attribute configuration without making field names deployment-configurable.

The 22 supplied candidate measurements have an explicit coverage decision: 9 are supported from durable Runtime facts and 13 remain outside Runtime ownership. Missing external evidence is reported as `unknown`; the Runtime does not manufacture zero or success values. Skill, Rule, workflow, Work, Evidence, Lifecycle, and Delivery measurements use bounded metric dimensions, while exact identities remain available only on drill-down events and spans.

## Facts and invariants proved

1. Skill consumption is counted only after a Host reports the exact consumed layer digest. Resolved or delivered layers do not enter the denominator.
2. Skill outcomes retain the same Run, Work attempt, invocation, and stable event identity. Formal correction facts use only `changes-requested`, `outcome-rejection`, `task-reopen`, or `repair-work`.
3. Rule measurements require a stable Rule identity, Evaluator identity/version, applicability, expected/triggered flags, and a persisted result receipt. Free-text rules and model claims cannot create a false hit or zero.
4. One logical workflow Run contributes one start and one terminal fact. Replay, process restart, or exporter retry does not increment the logical execution count.
5. Workflow, Work, Evidence, Lifecycle, Delivery, Skill, Rule, and workflow-Run metrics are all projected by `encodeObservationOtlpJson`; the deleted direct exporters have no production replacement path outside the canonical outbox.
6. Metric labels exclude exact Run, Work, Skill, Rule, and Evaluator identities. OTLP logs and spans retain allowlisted identities for drill-down.
7. Desktop and remote destinations receive semantically identical OTLP payloads. Transport endpoints, credentials, and timeouts do not affect envelope identity.
8. Generated `docs/telemetry-reference.md` is derived from the machine contract and is checked by `check:generated`; schema names are fixed protocol, not per-deployment aliases.
9. Bounded Desktop activation reasons remain observable without reopening the general free-text `reason` field.

## Verification commands and results

Executed on Windows with Node.js `24.21.0`:

```text
npm run verify
  TypeScript, Desktop TypeScript, ESLint, CLI build, and Desktop build passed
  167 test files passed
  734 tests passed; 2 skipped
  generated output, public naming, architecture, provenance, and Dashboard salvage passed
  OpenSpec strict validation passed after removing one empty untracked stale Change directory
  the previous managed execution report was correctly rejected because it did not cover this package boundary

npm run spec:validate
  18 strict OpenSpec items passed; 0 failed

npm run test:package-e2e
  1 test file passed; 1 test passed

npm run test:tracer-e2e
  1 test file passed; 1 test passed

npx vitest run test/desktop-run-activation.test.ts test/project-composition.test.ts test/provenance.test.ts test/e2e/runtime-tracer.e2e.test.ts
  4 test files passed; 15 tests passed

npx vitest run test/skill-run-binding.test.ts test/otlp-envelope-codec.test.ts test/observation-envelope.test.ts test/telemetry-observation-contract.test.ts test/telemetry-mapping.test.ts
  5 test files passed; 31 tests passed

npx vitest run test/telemetry-documentation.test.ts test/telemetry-metric-coverage.test.ts test/e2e/telemetry-measurement.e2e.test.ts test/e2e/otlp-configuration.e2e.test.ts
  4 test files passed; 5 tests passed

npm run check:provenance
  20 Comet-derived files, 60 immutable Cordis files, 33 Matt Skill files,
  8 fixed DSH packages, and 5 DSH Desktop references verified
```

The first complete `npm run verify` run found five genuine stale expectations: the bounded Desktop activation reason, the project composition digest, and the Comet-derived target digest. Those were corrected without weakening privacy or provenance checks. A second complete run passed all 167 test files and every product check before stopping only at strict validation of an empty, untracked stale Change directory. That directory contained no files and was removed. The explicit strict validation rerun then passed all 18 items.

## Privacy and cardinality evidence

The protocol-level E2E sends a unique free-text correction marker and exact Skill, Rule, Run, Work, and Evaluator identities through the canonical pipeline. Assertions prove that:

- free text, paths, credentials, headers, and endpoint URLs do not enter public attributes;
- exact identities are available in logs/spans but absent from metric labels;
- correction category, Skill role/category/result, Rule category/result, workflow identity/version/result, phase, Work kind, and lifecycle state remain bounded query dimensions;
- replay sends each logical envelope once per destination cursor.

## Documentation evidence

`docs/telemetry.md` documents standard OTLP deployment variables, precedence, secret boundaries, fixed field-name semantics, and a runnable Collector/SigNoz configuration. `docs/telemetry-reference.md` is generated from `domains/telemetry/observation-contract.ts` and contains the Resource, Span, Event/Log, Metric, Attribute, 22-item coverage matrix, formulas, missing-value semantics, and SigNoz query guidance.

## Cleanup

- The temporary npm package archive was created outside the repository and removed after this report was written.
- The empty untracked `close-runtime-telemetry-measurement-gaps` directory was removed; it contained no specification or user data.
- The temporary Comet `.codex` directory was moved outside the repository only during architecture verification and restored in `finally`.
- No Runtime Store, approval, checkpoint, or task state was edited to bypass a lifecycle gate.
- No mock receiver, debug log, package payload, or test workspace remains in the repository.
