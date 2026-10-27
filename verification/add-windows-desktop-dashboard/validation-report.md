# Windows Desktop validation report

## Reproducible subject

- Change: `add-windows-desktop-dashboard`
- Runtime Run: `change-repoctopus-add-windows-desktop-dashboard-f5ddf312046dbfbb`
- Tested implementation commit: `f9934d37201b817ad9c9df5fe18ef2e220db3f70`
- npm package: `repoctopus@0.1.0`, 972881 bytes, SHA-256 `9a7df4c2a883f0251d517af3bd1b53c9dd13d27083d7f07708949dfec80a5c8c`
- Windows candidate: `Repoctopus-Desktop-0.1.0-x64-Setup.exe`, 117167585 bytes, SHA-256 `30573d5b3916f124a3f5d988f4afa7c1695bf4c83c88064304607c30722163a3`
- Environment: Windows 10.0.26300 x64, Node.js 24.21.0

## Verification commands

| Command | Result | Evidence |
| --- | --- | --- |
| `npm run verify` | PASS | TypeScript, Renderer TypeScript, lint, both builds, 167 test files / 658 passed / 1 skipped, generated files, brand, architecture, provenance, 14 strict OpenSpec items and the pinned managed-execution report. |
| `npm run test:package-e2e` | PASS | Packaged CLI public journey: 1/1. |
| `npm run test:tracer-e2e` | PASS | Runtime tracer journey: 1/1. |
| `npm run test:desktop-e2e` | PASS | Real Electron Host/Receiver/Renderer process boundary: 4/4. |
| `npm run check:desktop-package` | PASS | Windows x64 installer, seven required package entries and seven deterministic resources. |
| `npm run test:desktop-package-e2e` | PASS | Install, activation, OTLP, single-instance forwarding, tray, direct exit and uninstall. |
| `npm run measure:desktop` | PASS | All five fixed resource budgets below. |
| `npm audit --omit=dev --audit-level=high` | PASS | Zero vulnerabilities reported. |

The first full verification run correctly rejected a stale source-level package-E2E contract after self-host Evidence gained a distinct Task identity. The contract was updated to require both explicit modes, its focused regression passed, and the complete verification matrix was rerun.

## Telemetry and self-bootstrap coverage

The installed Dashboard received the current real self-bootstrap trajectory through the production canonical OTLP/HTTP JSON exporter. The evidence contains 754 persisted events and reconstructs Open and Design as completed, Build as running, and Verify and Archive as not yet observed. It renders the active `build:8.2` Work, `repoctopus-build-task` action Skill and `tdd` augmentation Skill without fabricating future phase completion.

The canonical encoder now carries the authoritative `change.lifecycle.transitioned` projection as well as Work correlation derived from facts in the same immutable trajectory. A round-trip regression proves standard OTLP `eventName` is decoded without relying on a test-only `body`. The process-out-of-process dual-destination suite compares remote and desktop signal semantics and injects each one-sided failure independently; a failed destination neither changes the other destination nor the domain Run.

The wider coverage matrix is recorded in `telemetry-coverage-report.md`. It labels the older real trajectory slice and its synthetic contract supplements separately; synthetic Task, Decision, Evidence, recovery and pipeline examples are not presented as facts from this current Run.

Renderer CDP capture observed no HTTP request while projecting the self-bootstrap Run. Static boundary tests also reject Renderer network APIs, Node/filesystem access, Workspace scanning and periodic polling. The Desktop receives pushes from its authenticated loopback OTLP Receiver and never queries SigNoZ.

## Architecture, recovery and security

- Architecture governance verified 281 production sources, 22 capability owners, protected source boundaries, Evidence flow and legacy isolation. Desktop Main remains the native Shell owner; the Cordis product composition remains in the Desktop Host.
- Recovery tests cover projection snapshot/journal restart, duplicate convergence, corrupt-tail diagnostics, Host crash and serialized replacement, Renderer delta gaps followed by one snapshot recovery, graceful-stop escalation and Verify/Archive fallback histories.
- The Receiver binds a random loopback port and requires a per-process session credential. Discovery validation covers owner, freshness, PID creation identity and listener ownership. Forged discovery, stale/dead processes, hijacked ports and incorrect credentials are rejected.
- Renderer sandbox, context isolation, CSP, versioned IPC allowlist and sender/origin checks are enforced by negative architecture and IPC fixtures. Evidence and UI privacy fixtures reject bodies, absolute paths, Prompt/reply content, credentials and command output.
- Package E2E proves uninstall removes the executable but retains user data and never deletes Workspace-owned `.repoctopus/` or `openspec/` facts.

## Resource budgets

Measured at 2026-10-27T17:10:28.892Z against the candidate identified above. Results are machine-local release-candidate evidence; the fixed method and budget make later runs comparable.

| Metric | Measured | Budget | Result | Fixed method |
| --- | ---: | ---: | --- | --- |
| installerBytes | 111.7 MiB | at-most 150.0 MiB | PASS | Byte size of the versioned NSIS x64 setup candidate. |
| coldStartMs | 3887 ms | at-most 15000 ms | PASS | CreateProcess to authenticated Receiver discovery in isolated user data. |
| idleWorkingSetBytes | 462.1 MiB | at-most 700.0 MiB | PASS | Complete installed Shell/Renderer/Host process tree after a one-second idle settle. |
| activeWorkingSetBytes | 580.5 MiB | at-most 850.0 MiB | PASS | Same process tree after 300 authenticated OTLP requests and projection settle. |
| receiverRequestsPerSecond | 380.6 req/s | at-least 75.0 req/s | PASS | 300 accepted one-record requests at concurrency 16 divided by wall time. |

## Explicit limits

- A real team SigNoZ service was **not connected in this validation environment**. Remote standard OTLP protocol, privacy, fan-out and failure isolation are verified with process-external receivers; SigNoZ ingestion and dashboard queries remain a later environment-specific validation.
- Only Windows 10/11 x64 is `supported`. Windows ARM64, macOS x64/ARM64 and Linux x64/ARM64 are `unsupported`; Electron build capability is not treated as product support.
- This Dashboard is read-only observation. It does not replace Runtime authority, mutate lifecycle state or claim access to Agent internal reasoning.

## Evidence index

- `self-host-desktop-e2e.json`: installed current-Run self-bootstrap and zero Renderer HTTP requests.
- `windows-package-e2e.json`: clean-user install-to-uninstall Windows journey.
- `desktop-performance.json`: fixed resource methods, budgets and measurements.
- `telemetry-coverage-report.md`: observation-contract coverage and evidence provenance.

## Verdict

PASS for the declared Windows 10/11 x64 scope. The result is bounded by the explicit SigNoZ and unsupported-platform limits above; neither is reported as verified.
