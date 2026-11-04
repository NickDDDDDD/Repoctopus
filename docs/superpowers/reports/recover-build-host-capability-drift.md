---
change: recover-build-host-capability-drift
status: build-verification-in-progress
---

# Recover Build Host capability drift verification

## Contract result

Build capability authority now belongs only to the current immutable Work. `ExecutionBinding`
schema v3 owns coordinator Host identity and multi-repository workspace facts, but no capability
list or digest. Configure, Plan, Execute and Check use one `WorkDispatcher` pre-claim validator.
Outcome processing binds the original claim and revalidates only Binding-owned facts.

## Historical failure evidence

The preserved round4 Run remains read-only outside this repository:

- Run identity: recorded verbatim in the bounded fixture below
- State: Build Plan submission persisted under Execution Binding schema v1
- External Host capabilities: `build.autonomous`, `repository.read`, `specification.read`
- Boundary: claim, packet, invocation and Plan submission existed; the Plan validator had not run
- `run.json` SHA-256: `3c3ebad355ed17ab53a8c8e37aeda6d2f92d0321d22eba0296a57bade0ad07c1`
- `trajectory.jsonl` SHA-256: `ca0bacc0c652406e58138ad00d5542639aa574c76ff028fe8af84fc8583954f2`

The bounded, portable fixture is
`test/fixtures/build-host-capability-round4-failure.json`. The original Store was inspected
read-only and was not migrated or edited.

## Fresh vertical acceptance

`test/external-build-host-capability.e2e.test.ts` creates fresh single- and multi-repository Git
topologies and uses the public external Host service protocol through:

1. Configure with exactly `build.autonomous + repository.read + specification.read`.
2. Plan with the same read-only minimum, including duplicate pull, duplicate submission and a
   process restart before validation.
3. Execute first without `repository.write`, which records one bounded claim rejection and no
   claim, packet ownership or invocation.
4. Execute with exactly the current Work capabilities and real commit/push side effects.
5. Check with exactly `build.autonomous + process.execute + repository.read`.

Both variants reach Verify with one Plan revision and zero capability-driven Binding
revalidation transitions. The multi-repository variant executes and advances two packages.

## Recovery and observability

- Duplicate pull returns the authoritative packet and invocation; it never repeats context
  delivery or creates a second claim.
- Unknown execution retains the original invocation and uses `reconcile`; retry is permitted only
  after authoritative `not-executed` evidence.
- `work.claim-capability-rejected` carries bounded `capability-required`, `blocked` and missing-count facts.
  Capability text, Host identity, Work identity and digests are excluded from Metric labels.
- True Binding drift remains limited to coordinator Host, checkout/ownership/isolation and local
  overlay facts. Old Binding schema returns structured `migration_required`.

## Verification commands

Completed during Build:

- `npm run typecheck`
- focused domain, service, recovery, telemetry and observation tests
- existing managed single-/multi-repository Build E2E variants
- fresh external Host single-/multi-repository vertical E2E

Final `npm run verify`, strict OpenSpec, generated, architecture and provenance results are added
after the final commit is fixed.
