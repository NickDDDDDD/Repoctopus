# Telemetry Reconstruction Coverage Report

## Verdict

`complete`

The observation contract can reconstruct the five lifecycle phases, current Work and Task,
delivered Skill chain, Human Decision, wait, Evidence gate, rework, recovery and telemetry
pipeline health from normalized observation records alone. The coverage implementation has no
Workspace, OpenSpec, Git, Run-store or latest-snapshot input.

## Reproducible sources

- Real self-bootstrap Run: `change-repoctopus-adopt-comet-single-run-lifecycle-1784ada21df4159c`
- Raw Trajectory SHA-256: `a17d39d2025e0f6235702652b2924e7c0a54789adca426ac04ec2671d2fdcd5b`
- Real slice: identity-preserving records for Run, all five phases, Work, Skill, wait,
  continuation and the observed Archive-to-Design rework
- Synthetic supplement: versioned Task, Decision, Validator-start, Host-tool, Evidence-attempt,
  recovery and telemetry-pipeline records that did not yet exist in the pinned older Run

The supplement is deliberately identified as synthetic. It exercises protocol coverage and
fault states without misrepresenting those newer event families as facts from the older Run.

## Required coverage

| Requirement | Result | Reconstructed fact |
| --- | --- | --- |
| Run boundary | pass | Stable Run identity |
| Open | pass | Phase observed |
| Design | pass | Phase observed |
| Build | pass | Phase observed and current phase |
| Verify | pass | Phase observed |
| Archive | pass | Phase observed |
| Work lifecycle | pass | Create, claim, context, Host start/end and completion |
| Task lifecycle | pass | Start, completion, reopen and current Task |
| Skill chain | pass | Resolve, deliver, consume and current Skill roles |
| Decision boundary | pass | Request and resolution |
| Wait boundary | pass | Start and end |
| Tool observation | pass | Explicit observation plus bounded usage |
| Validator boundary | pass | Start and completion |
| Evidence boundary and gate | pass | Attempt start/end and gate result |
| Continuation | pass | Runtime-selected continuation |
| Rework | pass | Real phase regression plus Task reopen |
| Recovery | pass | Reconciliation fact |
| Telemetry pipeline health | pass | Delivery, Receiver and gap facts |

## Sensitivity and determinism

`test/telemetry-coverage-report.test.ts` removes the defining observation for each row above,
one requirement at a time. Every omission changes the report to `incomplete`, names the missing
requirement and makes `assertCompleteObservationCoverage` throw. A reversed input stream produces
the same projection after timestamp/event-identity ordering, and a replayed event is deduplicated
by stable event identity.

Command:

```text
npm test -- --run test/telemetry-coverage-report.test.ts
```

Result: 1 test file passed, 20 tests passed.
