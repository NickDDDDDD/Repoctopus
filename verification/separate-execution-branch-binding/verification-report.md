# Separate Execution Branch Binding Verification Report

## Reproducible subject

- Change: `separate-execution-branch-binding`
- Tested implementation commit: `346912c3ed9bacd8a13ad59e09f2de07a2b15fa2`
- Package: `repoctopus@0.1.0`
- Package content SHA-256: `0ecb2c4c9c861e4dfd7504f9b87ea309a502233692ce7047a97544696e905d6c`
- Package files: `449`
- Package content bytes: `5365876`
- Controller: external Comet `0.5.1` while the Repoctopus Runtime is under stabilization
- Platform: Windows x64
- Node.js: `24.21.0`

The tested implementation commit is the packaged-product boundary. Later commits may contain only Comet/OpenSpec lifecycle state or verification evidence. `check:managed-execution-report` independently reconstructs the normalized npm package-content digest and rejects later packaged-product changes.

## Authority boundaries proved

1. `ExecutionWorkspaceIntent` schema v2 records only the selected `current | branch | worktree` isolation mode plus Workspace and Change identity. It no longer contains a delivery target or a shared branch name.
2. `ChangeStartBinding` still freezes the coordinating repository source/target coordinates. Delivery intent remains the authority for publication source/target branches.
3. `ExecutionWorkspaceBinding` observes each repository's actual branch, revision and worktree ownership independently. It rejects detached or missing branch identity but does not require all repositories to share one branch name.
4. Build Plan validation remains the least-privilege point that derives exact writable repositories and rejects writable repositories still bound to protected branches before Execute.
5. The same Run can recover after a Runner prepares legal per-repository branches; Runtime re-observes Binding instead of revising the Open approval or inventing a shared branch.
6. Telemetry no longer advertises the removed `branch-mismatch` reason. Delivery target telemetry and protected-branch diagnostics remain intact.

## Test evidence

The initial focused TDD run failed four tests at the obsolete invariant `Branch isolation requires a target branch`. After the implementation:

```text
focused execution-workspace/build-protocol tests
  4 test files passed; 48 tests passed

npx vitest run test/managed-change-execution.e2e.test.ts -t "executes fresh Open"
  1 production-composition file passed
  4 tests passed; 1 unrelated test skipped
  duration 373.05 seconds

npm run verify
  TypeScript, Desktop TypeScript, ESLint and CLI/Desktop builds passed
  179 test files passed
  837 tests passed; 2 skipped
  generated output, brand, architecture, provenance, Dashboard salvage and
  18 strict OpenSpec items passed
  the report-freshness gate alone rejected the previous lifecycle report because
  this Change intentionally modified packaged product files
```

The exact production-composition digest snapshot was refreshed because the WorkflowRuns and execution-workspace plugin identities legitimately changed. The desktop activation E2E initially found the intentionally running real acceptance Dashboard; after stopping only that known instance, the focused desktop and composition tests both passed. The full verification run then completed all 179 test files without a test failure.

## Real five-repository acceptance

The preserved pre-fix Run was read with the new product and correctly reported `migration_required` for protected Runtime implementation changes. No compatibility wildcard or Store edit was introduced. A fresh acceptance Run was then started:

- Workspace: `agent-lab-runtime-acceptance-round3`
- Change: `add-compact-task-status-v2`
- Run: `change-agent-lab-workflow-sandbox-add-compact-task-status-v2-7cda1aab1e1b1e11`
- Coordinating repository: `codex/add-compact-task-status-v2`
- `backend`, `web-design`, `web-front`, `web-plugin`: `main`
- Delivery target: `main`

The Runtime delivered the complete Open packet with `repoctopus-open-change` and Matt `grilling`. The external Host proved consumption of both Skill layers, OpenSpec observed and strictly validated the four artifacts, and the user approved branch isolation through the trusted interactive Human Decision entry point.

The persisted `workspaceIntent` is schema v2 and contains only Workspace/Change identity, `isolation: branch`, semantic digest and intent id. It contains no `targetBranch`. Despite the five repositories using different branch names, Runtime advanced to Design and delivered `repoctopus-design-change` plus Matt `codebase-design`. This is the exact production path that previously failed before Design.

The acceptance Run intentionally remains at the first Design Work so the next product acceptance cycle can continue from a durable checkpoint instead of creating another synthetic Run. Repoctopus Desktop was restarted by the normal `run start` activation path and remains attached to this Run.

## Cleanup

- The temporary npm package archive used to compute the semantic package digest was removed.
- The old real Dashboard instance was stopped only for desktop single-instance E2E isolation; a new instance for the fresh acceptance Run was started through the normal product path.
- Product and acceptance Git worktrees are clean, and both feature branches and commits are pushed.
- No Runtime Store, checkpoint, packet, approval, trajectory or planning snapshot was edited to force progress.
- No compatibility bridge for pre-release Runtime state was added.

## Verdict

The packaged implementation cleanly separates execution isolation, per-repository observed Binding, coordinating source/target identity and delivery publication branches. Unit, production-composition E2E and real five-repository Open-to-Design acceptance prove the corrected behavior while preserving protected-branch enforcement for later writable Build packages.

The managed report freshness gate independently reproduced the package identity above and passed after this evidence-only report was added. No packaged-product change is permitted after the tested implementation commit.
