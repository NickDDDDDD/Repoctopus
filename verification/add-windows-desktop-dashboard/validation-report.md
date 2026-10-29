# Windows Desktop Dashboard validation report

## Reproducible subject

- Change: `add-windows-desktop-dashboard`
- Runtime Run: `change-repoctopus-add-windows-desktop-dashboard-f5ddf312046dbfbb`
- Tested product commit: `9e1629000aed1b303e63db124d844a0432f8d36c`
- npm package: `repoctopus@0.1.0`, 923759 bytes, SHA-256 `22140997f5f5b09e85fc92f899d0242afd7ce3effa4a9dbce54fd2c7ca8914f2`
- Windows candidate: `Repoctopus-Desktop-0.1.0-x64-Setup.exe`, 116494089 bytes, SHA-256 `c96418adee47145e2cd501d5abf6636596cdb21ea60ed829c55303850529b735`
- Environment: Windows `10.0.26300` x64, Node.js `v24.21.0`

The tested product commit is the implementation boundary. The reports and OpenSpec completion
state may be committed afterward, but any later packaged product change invalidates this report.

## Installed self-host result

The final installed candidate received 512 immutable events from this Change's real Runtime
Trajectory through the production canonical observation mapper and OTLP/HTTP JSON codec. The
export used two authenticated loopback requests; the Dashboard reconstructed:

- Open and Design as completed, Build as running, and Verify and Archive as not reported;
- all five Build actions and the active `build.execute:417ed2ee777f` Work;
- the `repoctopus-build-execute` action Skill and `tdd` augmentation Skill;
- validation/decision/recovery facts present in the real trajectory and all four independent
  health dimensions.

CDP network capture recorded zero Renderer HTTP requests. The installed Dashboard did not query
SigNoZ, scan the Workspace, read OpenSpec/Git/Runtime stores, or use periodic polling. A dedicated
self-host producer read the authoritative persisted Run and behaved like any other OTLP producer;
the product remained receive-driven.

The real self-host exposed two scaling defects that smaller fixtures had not reached. First, one
OTLP batch caused a full snapshot publication per event. Second, Host-internal deduplication and
gap bookkeeping crossed the 64 KiB Host protocol boundary. The fix commits each batch once to IPC
and emits a bounded transport snapshot while preserving the full journal inside the Host. Process,
protocol, persistence, provenance and installed self-host regressions cover the correction.

## Verification matrix

| Verification                       | Result | Evidence                                                                                                                                                                  |
| ---------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static, unit and integration suite | PASS   | TypeScript, desktop TypeScript, ESLint, build, generated output, brand, architecture, provenance, dashboard salvage, strict OpenSpec and managed-execution report checks. |
| Packaged CLI and Runtime tracer    | PASS   | Public package journey and multi-process OTLP tracer journey.                                                                                                             |
| Desktop Host process               | PASS   | Real Electron Host/Receiver/Renderer boundary, batched projection publication and restart recovery.                                                                       |
| Windows package inspection         | PASS   | Exact Electron/electron-builder versions, six package entries and fourteen deterministic resources.                                                                       |
| Installed self-host E2E            | PASS   | Install, activation, real Run OTLP replay, single-instance handoff, tray restore, direct exit and uninstall.                                                              |
| Standard installed E2E             | PASS   | Clean isolated user-data install-to-uninstall journey.                                                                                                                    |
| Dual-destination OTLP              | PASS   | Remote mock and Desktop receive identical canonical identities/semantics; either failure is isolated.                                                                     |
| Resource budgets                   | PASS   | Fixed release-candidate measurements below.                                                                                                                               |

## Architecture, security and recovery

- Electron Main owns only native Shell concerns. The isolated Node-mode Desktop Host owns the
  minimal Cordis composition, Receiver, application state and projection journal. Renderer runs
  with sandbox, context isolation, CSP and a versioned IPC allowlist.
- The Receiver binds a random IPv4 loopback port and requires a per-process Bearer token. User-level
  discovery validates owner, freshness, PID creation identity and listener ownership; forged,
  stale, hijacked and incorrectly authenticated cases are rejected.
- Canonical envelopes are mapped once from domain facts and fan out to independent remote and
  desktop destinations. Destination failure does not mutate the Run or suppress the other target.
- Projection recovery covers atomic snapshot/journal persistence, duplicate convergence,
  compaction, corruption diagnostics, delta-gap snapshot recovery, Host restart and graceful-stop
  escalation. The 10,000-event journal recovery test remains inside its 5-second and 256 MiB heap
  growth budgets.
- UI/Evidence privacy fixtures reject raw bodies, absolute paths, prompts, replies, credentials and
  command output. The Dashboard is read-only and cannot advance Runtime state.

## Resource budgets

Measured at `2026-10-28T18:34:04.111Z` against the candidate above. These are machine-local
release-candidate measurements with fixed, repeatable methods.

| Metric                                |         Measured |                 Budget | Result |
| ------------------------------------- | ---------------: | ---------------------: | ------ |
| Installer size                        |        111.1 MiB |        at most 150 MiB | PASS   |
| Cold start to authenticated discovery |          4943 ms |       at most 15000 ms | PASS   |
| Idle process-tree working set         |        444.3 MiB |        at most 700 MiB | PASS   |
| Active process-tree working set       |        509.2 MiB |        at most 850 MiB | PASS   |
| Receiver throughput                   | 495.9 requests/s | at least 75 requests/s | PASS   |

## Platform matrix and explicit limits

| Platform          | Status                     | Scope                                                                                     |
| ----------------- | -------------------------- | ----------------------------------------------------------------------------------------- |
| Windows 10/11 x64 | supported                  | Installer, lifecycle, Receiver, accessibility, high DPI, recovery and uninstall verified. |
| Windows ARM64     | unsupported / experimental | No release candidate or native verification in this Change.                               |
| macOS x64 / ARM64 | unsupported / experimental | Electron capability is not a product support claim.                                       |
| Linux x64 / ARM64 | unsupported / experimental | Electron capability is not a product support claim.                                       |

- A real company SigNoZ service was **not connected** in this environment. Standard OTLP
  contracts, remote fan-out and failure isolation are verified against process-external receivers;
  environment-specific SigNoZ ingestion/query validation remains follow-up work.
- Existing data from the abandoned Dashboard branch was **not migrated**. The new projection starts
  from canonical OTLP facts and has no compatibility path for obsolete local formats.
- The application is an observability surface, not a Runtime controller and not a replacement for
  the Runtime-authoritative Open → Design → Build → Verify → Archive workflow.

## Evidence index

- `self-host-desktop-e2e.json`: installed current-Run self-host and zero Renderer HTTP queries.
- `windows-package-e2e.json`: isolated install-to-uninstall candidate journey.
- `desktop-performance.json`: fixed methods, budgets and final measurements.
- `cleanup-evidence.json`: bounded temporary-artifact/process/discovery cleanup audit.

## Verdict

PASS for the declared Windows 10/11 x64 scope, bounded by the explicit SigNoZ, migration and
unsupported-platform limitations above.
