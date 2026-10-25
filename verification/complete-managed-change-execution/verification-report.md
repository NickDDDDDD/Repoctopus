# Managed Change Execution Verification Report

## Subject

- Change: `complete-managed-change-execution`
- Tested implementation commit: `173938d359202acfc1373c248c29fb33016338bb`
- Branch: `feat/complete-managed-change-execution`
- Package: `repoctopus@0.1.0`
- Package bytes: `937712`
- Package SHA-256: `3ed1746395de3cbc09fa34fb7394d198996f0f667a440e37cc6e62671d36c575`
- Lifecycle definition: `repoctopus-change@2.0.0`
- Lifecycle definition digest: `sha256:8ffa2adcb0b9837858a24d96f5410dd776828905d21fd481805f1e2d741df7cd`
- Production composition rule: the exact composition digest is frozen into every Run and asserted by the black-box harness; it is intentionally environment/configuration specific rather than copied as a package-global constant.

The report commit may contain only this Evidence document. Verification remains valid only while the tested implementation commit is an ancestor and the diff contains no packaged product file; any product/package change requires a new package checksum and a full rerun.

## Required commands

All commands completed successfully on Windows with Node.js `24.21.0`:

```text
npm run verify
  118 test files passed
  434 tests passed, 1 skipped
  generated output, brand, architecture and provenance checks passed
  OpenSpec strict validation: 14 passed, 0 failed

npm run test:package-e2e
  1 test file passed, 1 test passed

npm run test:tracer-e2e
  1 test file passed, 1 test passed

npm pack --json --pack-destination <isolated-temp-directory>
  repoctopus-0.1.0.tgz
  SHA-256 3ed1746395de3cbc09fa34fb7394d198996f0f667a440e37cc6e62671d36c575
```

## Fresh five-stage black-box evidence

`test/managed-change-execution.e2e.test.ts` starts a packaged-CLI fresh Run in a temporary two-repository Git Workspace with no change directory, then uses the production Cordis composition plus the test-only `CapturingWorkExecutionHost`. The Host replaces model inference only; real Skill Registry, OpenSpec Provider/Store, Run/Action stores, RuntimeWorkGuard, validators, filesystem operations, Evidence and Archive services remain active.

- Run identity: `change-managed-blackbox-managed-blackbox-g1-8defaa70220e5f39`
- Mode: `fresh`
- Host sequence: `change.intake`, `specification.plan`, `task.implement:1.1`, `task.implement:1.2`, `evidence.verify`, `specification.close`, `delivery.publish`
- Required event order per attempt: `work.claimed` → `work.context-delivered` → `work.host-started` → `tool.completed` → `work.host-completed` → `work.completed` → `validator.completed` → lifecycle transition
- Work, packet, invocation, operation, Receipt and event identities are asserted for uniqueness/order through the public inspection projection. The public projection and persisted Run are also scanned to prove that packet bodies are absent.
- Both Build tasks use independent Work/packet/Receipt/Validator boundaries. Task checkbox commits are pushed before planning is re-evaluated. Verify still runs after all adopted or Runtime-produced completion claims.
- Archive closes the real OpenSpec change first, then creates and validates a distinct publication Work. The final Run is completed from a full Publication Receipt and remains independent of later MR merge state.

## Historical red baselines

1. Identity-only claim: the pre-change public claim returned only Action/Skill identity although the assembler held content. `test/e2e/change-design-gate-cli.e2e.test.ts` now consumes the packaged Host protocol and asserts actual ordered layer bodies; ordinary human/status projections remain redacted.
2. Automatic Open transition: `repoctopus-change@1.1.0` allowed the first `run next` to synthesize `open-intake-ready`. The new `2.0.0` definition keeps the same Open Work/attempt until the original Host Outcome and `open.intake-ready` Validator identity are accepted.

The old G1 bootstrap history remains read-only. Definition, composition, Skill or Provider drift returns `migration_required/new-generation-required`; it is not reinterpreted under generation 1.

## Controlled anti-cheating failures

The acceptance harness contains three independent sensitivity checks:

1. Automatic/naked lifecycle facts are rejected by the transition domain and cannot replace the bound Open Work, Outcome, Receipt and Validator chain.
2. A Host that reports success without consuming every delivered action/augmentation Skill layer is rejected with `must prove consumption`; no Outcome or phase fact is accepted.
3. A forged Validator/Receipt or an Outcome with a different Host, invocation, packet, attempt or Work identity is rejected before transition. The external CLI test covers forged Host, forged packet and expired/cross-Work fencing.

Additional fail-closed coverage includes no Host, ambiguous Host, capability mismatch, write-before-context-delivery, expired session, cross-Run session, repository/scope escape, fresh imported claim, Skill/Provider drift, missing/corrupt referenced Intent and identity-only inspection.

## Recovery matrix

| Persisted boundary | Continuation | Verified behavior |
| --- | --- | --- |
| Work selected, no claim | `execute` | Runtime creates/returns the one current Work |
| Claim or context delivered | `execute` | Reassembles the same packet and attempt; digest drift fails closed |
| Host session active | `wait` | No competing invoke |
| Host result unknown | `reconcile` | No automatic replay of possible side effects |
| Host proves not executed | `execute` | Only then may Runtime create attempt + 1 |
| Host proves executed | `wait/execute` | Persists original Outcome and continues at Validator |
| Outcome persisted | `execute` | Validator resumes without invoking Host |
| Validator persisted | `execute` | Transition journal completes idempotently |
| Human Decision waiting | `ask` | Same request/proposal hash is retained |
| Coordination missing/stale | unchanged | Hint cannot authorize or claim completion |
| Skill/Provider/definition/project drift | `reconcile` or migration | Old Run remains read-only |
| Terminal Run | `done` | No execution suggestion |

Coverage comes from `test/work-execution-recovery.test.ts`, `test/runtime-store.test.ts`, `test/action-claims.test.ts`, `test/runtime.test.ts`, `test/e2e/change-design-gate-cli.e2e.test.ts` and the fresh five-stage harness. RunStore Journal tests terminate/recover around append, Run, checkpoint and response-loss boundaries; Managed Host reconciliation proves unknown/no-reconcile cases never call `invoke` again.

## OTLP taxonomy, privacy and cardinality

`test/e2e/managed-execution-otlp.e2e.test.ts` sends the persisted execution taxonomy to a real local OTLP HTTP receiver and observes `/v1/traces`, `/v1/logs` and `/v1/metrics`. Replay produces byte-stable trace payloads. Runtime telemetry cursor/outbox tests cover unavailable collectors, restart, backlog replay and duplicate delivery without changing Work/phase results.

The common Change Run trace contains phase, Work attempt, Host, protected tool, Validator, wait/reconcile and continuation facts. Skill `resolved`, `delivered` and `consumed` remain distinct; consumption comes only from the Host receipt. Metric labels normalize unknown/free-form inputs to bounded `custom|unknown` categories and exclude run/change/task/repository IDs, digests and invocation IDs.

Malicious payload tests include prompt/response text, command, absolute path, URL, arguments and secret markers. None appear in OTLP payloads. Packet, Skill and Provider bodies are absent from Run, checkpoint, public human output and package test artifacts.

## Fresh/adopt matrix

- `fresh` + all pending: starts Build at the first ready Task.
- `fresh` + imported partial/all complete: adoption conflict; requires a new explicit generation.
- `fresh` + current `runtime-work` Receipt: allowed and resumes from the next ready Task.
- `adopt-existing` + partial complete: imports existing claims and starts at the first pending Task.
- `adopt-existing` + all complete: skips duplicate Build execution but still creates/runs Verify.
- Any Task semantic revision drift invalidates the old completion binding.

## Explicit exclusions

- No model-vendor-specific production Agent Host is shipped by this change. The versioned Host port and external CLI protocol are complete; vendor authentication, streaming and model policy belong to later Host plugins.
- Repoctopus is not an operating-system sandbox. Direct external file/process activity cannot receive a managed Receipt and is observed only as drift.
- The Run does not wait for or merge Business/Specification MRs. Publication Receipt completes Archive; later remote divergence is handled by bounded reconciliation and a normal follow-up Change.
- The paused Windows Desktop Dashboard change is not modified here.

## Verdict

All 40 tasks in `openspec/changes/complete-managed-change-execution/tasks.md` are implemented and verified. The managed five-stage workflow is pull-based, Runtime-authoritative, Host-mediated, resumable at persisted boundaries, multi-repository aware and projected through one privacy-bounded OTLP protocol.
