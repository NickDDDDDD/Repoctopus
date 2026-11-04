---
change: stabilize-archive-publication-recovery
design-doc: openspec/changes/stabilize-archive-publication-recovery/design.md
base-ref: c4022afc5fa96f153fef9dfd59c31c0d82d30c3a
archived-with: 2026-11-04-stabilize-archive-publication-recovery
---

# Stabilize archive publication recovery implementation plan

<!-- comet-task-authority: openspec/changes/stabilize-archive-publication-recovery/tasks.md -->

## Implementation constraints

- Keep `openspec/changes/stabilize-archive-publication-recovery/tasks.md` as the only completion authority. This plan maps executable packages to stable task IDs and must not become a second checklist.
- Use the approved `autonomous + tdd + thorough` configuration. Start each behavior change with a focused failing assertion, implement the smallest domain-safe correction, then run affected regressions.
- Preserve the Comet 0.5.1 recovery invariant: unknown external effects retain the original intent/invocation and are never replayed; a later attempt is allowed only after bounded `not-applied` evidence.
- Preserve Repoctopus multi-repository identities. A recovery never changes runId, publicationId, operationId, repository/base/head/head OID or creates a replacement Run.
- One pull may perform at most one new create invocation. A confirmed rejection returns control to the caller; it does not start an internal retry loop.
- Do not infer certainty from human error text. Platform adapters produce typed bounded facts; unknown third-party errors default to `unknown`.
- Keep platform types out of Delivery domain policy. Shared contracts carry certainty; GitHub maps HTTP/transport/parse facts into that contract.
- Do not add daemon, webhook, merge waiting, automatic merge, generation counters, Store edits, compatibility readers or a second lifecycle.
- `completed` is authoritative. Read-only projectors cannot reopen or overwrite a terminal Run from trajectory history.

## Work package 1: Freeze both production regressions with RED tests

<!-- comet-task-ref:6d44c990-5ac0-4cea-95fd-ae0f6e17410f -->
<!-- comet-task-ref:7af771ba-2368-4867-bca2-cdc1627eaea1 -->
<!-- comet-task-ref:7fdcc054-f3b4-46fe-9901-5f0fa699e30b -->

Extend `test/change-continuation.test.ts` with a completed Archive checkpoint, null current Work and a newer-looking historical null-work `continuation.selected`. Assert `done/terminal`, null work/attempt, current epoch and empty next actions through the domain projector and the public Runtime status projection.

Extend `test/github-merge-request.test.ts` with table-driven create responses for 401, 403, 404, 409/422, 429, 500, rejected fetch and 2xx invalid JSON. Freeze bounded platform code plus the new effect certainty without storing body or credentials.

Extend `test/stable-publication.test.ts` and `test/resumable-publication.test.ts` so a definite 4xx rejection must not become permanent `mr-unknown`, while transport/5xx/parse/post-create-verification failures remain observation-only. Assert exact create/observe counts, stable item identity, attempts and durable states.

Run these focused files before production edits and retain the failing assertions as the causal baseline. Existing unknown-no-replay tests must remain green.

## Work package 2: Introduce one bounded external-effect certainty contract

<!-- comet-task-ref:d532123d-6d54-4bc0-92ea-a1c263af665b -->
<!-- comet-task-ref:f279aa1e-58f6-4977-b7f7-afc70b26f43c -->
<!-- comet-task-ref:6d0c3bc1-ceb3-4c6c-9927-e43b58b3c753 -->

Add a Delivery-owned `not-applied | unknown` contract and `PublicationNotAppliedError` beside `domains/delivery/publication-result-unknown.ts`. Expose a narrow type guard/classifier that accepts typed adapter failures and defaults every unclassified error to unknown. Keep publicationId, stage and bounded reason available to diagnostics; preserve the original cause only in the in-memory error chain.

Extend `platform/github/merge-request.ts` so `PlatformRequestError` carries effect certainty. Explicit 4xx responses are `not-applied`; 5xx, fetch/transport failures and successful responses whose JSON cannot be parsed are `unknown`. Preserve existing authentication/permission/feature/not-found/rate-limit/temporary codes and capability behavior.

Refactor `domains/delivery/stable-publication.ts`: pre-create observation remains unchanged; a not-applied create error becomes `PublicationNotAppliedError`; unknown create or post-create verification errors attempt exact recovery observation once and otherwise become `PublicationResultUnknownError`. Exact recovered MR behavior stays `recovered`.

Focused GREEN evidence covers every certainty source and proves the Delivery domain imports no GitHub concrete type.

## Work package 3: Recover business and specification journals without replay

<!-- comet-task-ref:bd2af5eb-851a-4679-8d2a-34d04e0e8280 -->
<!-- comet-task-ref:c5de9105-754f-4652-8a95-253cd7ab5f0b -->
<!-- comet-task-ref:5e7a996b-31a8-4521-8071-1ac0a0f98cdd -->
<!-- comet-task-ref:5f6bdcf1-fbd6-4756-9367-dba1fc8e5df7 -->

In `domains/delivery/publication-journal.ts`, handle `PublicationNotAppliedError` separately from unknown. After a persisted `mr-invoking`, atomically return the same item to `pushed`, retain operationId/intent/attempts, record only a bounded diagnostic and throw the not-applied error to end the current pull. The next explicit call first observes and may then invoke create once.

Keep `mr-invoking`/`mr-unknown` recovery observation-only. Zero matches remains unknown, a unique exact match completes as recovered, and ambiguous/OID-mismatched candidates fail closed. Add restart and repeated-call coverage proving create count never grows in unknown.

Apply the same certainty distinction to `platform/delivery/specification-publication.ts` and its journal transition contract. Do not change push uncertainty rules. If the specification journal schema needs an additional legal transition, make it explicit and test it; do not add a version fallback.

In `services/workflow-runs.ts`, only `PublicationResultUnknownError` calls `markExternalSideEffectUnknown`. `PublicationNotAppliedError` leaves the current Archive Work available for a later explicit pull and never forges a Receipt or accepted Outcome.

Run publication journal, specification publication and archive lifecycle suites, including process-restart fixtures.

## Work package 4: Make terminal continuation authoritative

<!-- comet-task-ref:46371dc0-6fce-4c46-81f9-5948a71ba78e -->
<!-- comet-task-ref:64e74557-21e4-4d5b-b5ce-d87f9eaa1c1c -->
<!-- comet-task-ref:86e77841-206d-460e-a92f-032f2da8dded -->

In `domains/change-lifecycle/continuation.ts`, return the classified `done/terminal` result before trajectory lookup. Preserve the current check epoch while forcing workId/attempt to null for completed state.

Tighten `matchesCurrentCheckpoint` for non-terminal replay: require matching run and current state/check epoch, Work identity and attempt where present. Legacy events that cannot prove the current checkpoint must fall back to pure classification; do not mutate or migrate historical events.

Add vertical regressions through `domains/runtime/workflow-runs.ts`, CLI continuation/status tests and Desktop reducer/projection tests. All surfaces must show the same terminal result without packet, Host, platform or filesystem I/O.

Run continuation, runtime-store/status, CLI and Desktop focused suites.

## Work package 5: Add bounded diagnostics, telemetry and operator documentation

<!-- comet-task-ref:2fb9d881-fb2d-4366-886b-6b669fac9026 -->
<!-- comet-task-ref:7fbadff0-bbc3-40b0-a702-b7f7edcac868 -->
<!-- comet-task-ref:6062e26f-ad45-4434-b7ad-b4e679867be1 -->

Project not-applied diagnostics through the existing Runtime/CLI error surface: identify stage and bounded platform reason, retain the original publication item, and instruct the operator to repair credentials/permission/configuration before pulling the same Archive Work again. Unknown diagnostics must instruct exact observation/adoption or authoritative reconciliation and explicitly avoid blind create retry.

Extend existing trajectory/OTLP mapping only where the new fact is emitted. Metric dimensions may contain bounded stage, certainty and result enums; repository ID, branch, path, URL, runId, digest, response body and arbitrary error message remain trace/evidence-only under current redaction policy.

Update the existing Delivery/Runtime recovery documentation with the HTTP boundary table, same-intent recovery flow and Comet provenance. Do not create an ADR or implementation notes.

Run telemetry mapping/cardinality/privacy, CLI error and documentation/provenance checks.

## Work package 6: Package, accept, review and clean

<!-- comet-task-ref:ef729e5f-6f32-446f-820e-a8ba4d29afec -->
<!-- comet-task-ref:e0933926-1174-4887-a632-ce6c82d7bdd0 -->

Build a clean packaged CLI and run an isolated Archive recovery fixture with a fake platform adapter. Demonstrate: 4xx rejection ends the first pull, correction lets the same item complete on a later pull; unknown results never replay create; a later exact MR is adopted; the fifth-round completed checkpoint projects only terminal. Do not create a real MR or modify preserved acceptance evidence.

Perform thorough review for certainty widening, hidden retry loops, platform-domain coupling, unsafe journal transitions, credential leakage, high-cardinality metrics and terminal projection regressions. Repair important findings with focused tests.

Run strict OpenSpec, targeted suites, typecheck, lint, generated/brand/architecture/provenance/dashboard checks and full `npm run verify`. Record the exact commands/results in the formal verification report used by Verify; do not add implementation notes.

Remove temporary logs, scratch fixtures, generated test registries and local package outputs created only for troubleshooting. Preserve the OpenSpec/Comet artifacts, formal evidence and public branch history. Report what was cleaned.

If any path replays an unknown create, changes stable publication identity, marks not-applied as accepted success, or projects a completed Run as non-terminal, stop Build and revise the approved Design instead of adding a bypass.
