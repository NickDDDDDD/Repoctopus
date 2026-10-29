# Runtime Build Orchestration Verification Report

## Reproducible subject

- Change: `restore-runtime-build-orchestration`
- Tested implementation commit: `9e1629000aed1b303e63db124d844a0432f8d36c`
- Package: `repoctopus@0.1.0`
- Package bytes: `923759`
- Package SHA-256: `22140997f5f5b09e85fc92f899d0242afd7ce3effa4a9dbce54fd2c7ca8914f2`
- Lifecycle definition: `repoctopus-change@4.2.0`
- Lifecycle definition digest: `sha256:4bef956969843eb8862947abdedaf5de59d8aa34237debc3387996b8944e8952`
- Verification runId: `change-verification-workspace-restore-runtime-build-orchestration-9fda2eb7bf05fdf5`
- Black-box runId: `change-managed-blackbox-managed-blackbox-a56af5c947f984ce`
- Build Configuration: `build-configuration:984df01c5c917e6286a1e112`
- Build Configuration digest: `sha256:af6f56776fd582eca909f27e86f0d22804d82cd7984df01c5c917e6286a1e112`
- Build Plan revision 1: `build-plan:4e6fa164e2fe59548e6c1164`
- Build Plan digest: `sha256:f3191d33ce636a38a19ae7f397f7faee898d483b4e6fa164e2fe59548e6c1164`
- OpenSpec Task-set digest: `sha256:d96a472d5f9b11f299872af949d92193398bfe295dc727cd7f7eeefb6629cc2f`

The implementation commit is the package boundary. Later commits may change only OpenSpec state, verification evidence, or the report checker. Any later packaged product change makes this report stale. `test/build-orchestration-verification.test.ts` independently recomputes every definition, configuration, plan, Task-set, and Run identity above.

## Verification commands

Run on Windows with Node.js `24.21.0`:

```text
npm run verify
  TypeScript, desktop TypeScript, ESLint, generated output, brand and architecture checks passed
  141 test files passed; 541 tests passed and 1 skipped
  provenance passed; OpenSpec strict validation passed 14 items with 0 failures
  this report's commit ancestry and npm package checksum were reproduced

npm run test:package-e2e
  1 test file and 1 test passed

npm run test:tracer-e2e
  1 test file and 1 test passed

npm audit --omit=dev --audit-level=high
  0 vulnerabilities
```

The refreshed Windows Desktop Dashboard implementation remains inside the same managed Runtime
contract. Its final installed self-host replay exposed and fixed a batched projection IPC scaling
defect without changing Runtime Action authority, lifecycle transitions, immutable Work bindings,
or the DSH-derived Host-process slice. Provenance, multi-process tracer and managed black-box
regressions all pass against the pinned product commit above.

## Runtime authority

Build now has one definition-owned internal protocol:

```text
Configure -> Plan -> Plan Evidence -> Execute -> Check -> Verify
```

The Runner or Agent pulls `run next`; it does not choose the next Action. The Runtime derives a frozen Work Descriptor, resolves the exact action and augmentation Skill bodies, binds one Host invocation, validates the structured Outcome, and only then advances. `autoTransition` controls whether another pull may continue immediately; it does not authorize phase or Action jumps.

Configuration freezes execution mode, TDD mode, standard review, isolation, repository topology, Host identity, and Host capabilities. The Plan is an execution projection of OpenSpec Tasks rather than a second specification authority. A Plan may split or merge Tasks and express a package DAG, but every Task, acceptance identity, repository, write scope, and dependency must validate against the frozen inputs.

## Black-box and recovery evidence

`test/managed-change-execution.e2e.test.ts` executes three fresh Changes with the production Cordis composition and a test-only Host adapter:

1. autonomous execution with one business repository;
2. autonomous execution with two business repositories;
3. subagent-driven development with two business repositories.

Each Change runs Open -> Design -> Build -> Verify -> Archive. The test closes and reboots the Application after Configure, Plan/Plan Evidence, every Execute package, and Check. The single-business-repository Plan advances without an extra risk decision. Cross-repository package ordering is classified as high risk and cannot execute until a trusted Plan decision is persisted.

The multi-repository cases bind the Workspace Store plus `app` and `worker`; their second package depends on the first package across repositories. Both execution modes preserve the same Run, Plan revision, package completion, Task projection, and `checkEpoch` across restarts. Subagent mode additionally requires an attested coordinator capability and a succeeded implementer receipt for the current package.

Crash and response-loss coverage proves:

- transition journals recover exactly once after journal, trajectory, Run, or checkpoint interruption;
- topology, repository identity, isolation, branch, worktree ownership, capability, and packet drift fail closed;
- a lost subagent response becomes `unknown` and never becomes inferred success or an automatic replay;
- only explicit `not-executed` reconciliation may authorize another attempt;
- Build Check and Verify implementation findings create an ordinary Plan revision in the same Run;
- completed Task claims remain monotonic while current Plan and Check Evidence determine validity;
- evidence-infrastructure failure retries Verify, while a design-level finding requires a Human Decision before returning to Design.

## Telemetry and anti-cheating evidence

Trajectory and OTLP mappings cover phase, Build Action, Work claim, Host invocation, protected tool, Skill resolution/delivery/consumption, Validator, approval, Plan revision, delegation, continuation, and invalidation. Metric labels are bounded to action, execution mode, TDD mode, review mode, isolation, result, and known categories. Run, Task, package, repository, digest, free-form Skill, and Agent identities are excluded from metric labels.

Acceptance tests reject all known bypasses: legacy `task.implement`, Build adoption, special Repair Work, Task reopening, Host-selected next Action, mode switching, review disabling, out-of-scope Skills, repository escape, missing delegation receipts, unconsumed Skill content, and a fifth planning artifact.

## Verdict

The managed workflow is pull-based, Runtime-authoritative, Host-mediated, multi-repository aware, and recoverable at every Build boundary. OpenSpec Tasks remain the semantic planning authority; Build Configuration and Build Plan are immutable, content-addressed execution records. Verify rework uses normal Plan/Execute/Check semantics rather than a parallel Repair lifecycle.
