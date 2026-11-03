---
change: bootstrap-openspec-store-root
design-doc: openspec/changes/bootstrap-openspec-store-root/design.md
base-ref: 75bc3b325e04353b88d13b3e15ffa618561bfebe
archived-with: 2026-11-03-bootstrap-openspec-store-root
---

# Bootstrap OpenSpec Store root implementation plan

<!-- comet-task-authority: openspec/changes/bootstrap-openspec-store-root/tasks.md -->

## Implementation constraints

- Keep `openspec/changes/bootstrap-openspec-store-root/tasks.md` as the only task/completion authority; this plan only maps execution packages to stable Comet task IDs.
- Use the approved `autonomous + tdd + thorough` configuration. Every behavior change starts with a focused RED assertion and records its GREEN command before checking off the task.
- Execute the fixed repository `@fission-ai/openspec@1.14.3` entry through `SpecificationProcessPort`; never shell out through PATH, hand-write Provider internals, or use `store setup`.
- Preserve one request-scoped onboarding transaction. Do not add a second lifecycle, generation, daemon, Runtime Store edit, or compatibility implementation of direct registration for a missing root.
- Fail closed for pre-existing partial roots, metadata/registry conflicts, approval drift, unknown ownership, and changed manifests. Never delete or overwrite user-owned OpenSpec files.
- Publish in the strict order `prepare-root → register-store → business pointers → repoctopus.yaml`; tests must prove the negative side effects at every interrupted boundary.

## Work package 1: Reproduce the real CLI failure and freeze the approved root plan

<!-- comet-task-ref:a16a9ada-5fac-4865-a293-2acca31d93c2 -->
<!-- comet-task-ref:71440e4c-282c-4f42-86f0-fdf502cfd526 -->
<!-- comet-task-ref:cc26b368-0cd5-47db-89cb-6a73e0742ac1 -->

Add a real-CLI RED case under the OpenSpec registration/onboarding test area that creates a non-empty temporary Git workspace with no local `openspec/`, invokes the fixed entry with an isolated data/config environment, and captures `store_register_root_unhealthy`. Extend the project-detection domain with a normalized root-disposition Evidence object and include it in `OpenSpecStoreBindingProposal`, the draft digest, and the project-configuration Human Decision snapshot. Add a platform observer that combines exact `<workspace>/openspec` file facts with structured Provider output and rejects a parent nearest root. Reobserve this identity before apply and assert that directory, Provider, Store, checkout, or metadata drift produces no side effect.

Focused verification: run the new real-CLI regression plus `test/project-detection.test.ts` and `test/project-onboarding.test.ts`; inspect the prepared decision payload and prove all five dispositions and equivalent Windows paths are deterministic.

## Work package 2: Introduce a recoverable root-preparation contract

<!-- comet-task-ref:ff63347b-0e34-4ec3-9ce3-3def97bada2c -->
<!-- comet-task-ref:da04cbde-6ed9-4d20-88ea-3eddddb2719b -->
<!-- comet-task-ref:6d4d51e8-d67b-488e-95d6-6de141a78f1f -->
<!-- comet-task-ref:18a2b717-dcba-4b9d-a179-b325d11efe93 -->

Extend `domains/project-configuration/store-binding.ts` with a `prepare-root` Intent/Receipt and stable result/diagnostic codes. Refactor the OpenSpec platform boundary into explicit observe, initialize, and registration operations while keeping `OpenSpecProcess` as the only process executor. For `missing-root`, persist Intent before running the exact approved init argv, snapshot only the owned `openspec/` subtree, and reobserve official root health after execution. On retry, reconcile no-root, healthy-owned-root, healthy-pre-existing-root, partial-root, and manifest-drift states without trusting stdout. For healthy roots write `already-healthy`; for partial or unowned roots return a doctor diagnostic and invoke neither force cleanup nor downstream registration.

Focused verification: run store-binding and OpenSpec adapter unit tests after every RED/GREEN slice. Inject interruption after Intent, during init, after filesystem mutation, and before Receipt; assert one stable result and byte-for-byte preservation of pre-existing/concurrent files.

## Work package 3: Make registration and onboarding configuration-last

<!-- comet-task-ref:552117de-8eda-415f-9239-35e2c2674bb0 -->
<!-- comet-task-ref:154bec2d-4910-460d-a597-1dafd881f38b -->
<!-- comet-task-ref:0e188f2c-9af8-4a9f-abb0-e064b1433d44 -->
<!-- comet-task-ref:204abef3-ad6a-41c7-8d46-3db397a3c2b4 -->

Change `OpenSpecStoreRegistration` to require healthy-root Evidence, classify structured registry/metadata outcomes, perform idempotent register, and verify explicit context points to the exact checkout. Update `applyStoreBinding()` to create/recover prepare-root before the existing register Intent, then preserve pointer ordering and keep `repoctopus.yaml` publication last. Add the real reported recovery shape—existing matching register Intent and missing Receipt—to prove the new code continues the same request rather than retaining the broken direct-register branch. Preserve the current local-authority/pointer conflict rules so Workspace initialization cannot grant write authority over business-repository roots.

Focused verification: run `test/openspec-store-registration.test.ts`, `test/project-onboarding.test.ts`, and the documented onboarding E2E with fault hooks at every ordered boundary. Assert repeated apply only fills missing Receipts and never duplicates init, metadata, registry, pointer, or configuration writes.

## Work package 4: Isolate and run the official CLI acceptance matrix

<!-- comet-task-ref:93f7ef4f-a3e2-4396-825c-139852e661bf -->
<!-- comet-task-ref:96214594-b3ad-4599-825e-15d211570573 -->
<!-- comet-task-ref:d049e637-13e1-4612-8b19-06c5c44dae7e -->
<!-- comet-task-ref:30c48b2f-61cf-4812-ba36-cfb4e528ddca -->

Create a reusable test fixture that launches the fixed CLI with temporary `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, telemetry/update checks disabled, and validated cleanup roots. Snapshot the real user registry before/after. Exercise fresh non-empty Workspace, healthy unregistered root, exact registration, init-result loss, register-result loss, partial root, metadata mismatch, store-id/path conflict, nearest-parent root, and a multi-repository pointer conflict. Update onboarding/specification/troubleshooting docs with the exact operator contract. Update the Comet adoption report only for behavior actually adapted and verified; do not claim source copying.

Focused verification: run the CLI matrix on Windows, package E2E, strict OpenSpec, provenance, architecture, and documentation checks. The fixture must fail if isolation cannot be proven and must leave the developer registry unchanged.

## Work package 5: Product acceptance, review, and cleanup

<!-- comet-task-ref:0b0685d1-d0bb-4297-92c0-dde871e70977 -->
<!-- comet-task-ref:ecd214c7-ca00-436b-8778-24f863f76371 -->

Use a clean simulated multi-repository project—not Repoctopus self-hosting—to run the packaged CLI from detect through trusted approval, root initialization, explicit Store context, pointer installation, and creation/strict validation of a minimal Change. Start a second isolated process against the same test registry to prove cold consumption. Then run all focused tests, `npm run verify`, package/tracer E2E, strict OpenSpec, generated/brand/architecture/provenance checks, and Comet Build/Verify guards. Perform thorough review over the complete diff, repair every critical/important finding, rerun affected checks, and remove temporary repositories, isolated registries, logs, and scratch output.

If any official CLI fact contradicts the approved design, stop Build and revise Design through Comet rather than weakening a test or adding a private OpenSpec implementation.
