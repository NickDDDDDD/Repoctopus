# Windows Desktop validation report

## Resource budgets

Measured at 2026-10-27T16:27:52.985Z on Windows 10.0.26300, Node v24.21.0, x64. Results are machine-local release-candidate evidence; the fixed method and budget make later runs comparable.

| Metric | Measured | Budget | Result | Fixed method |
| --- | ---: | ---: | --- | --- |
| installerBytes | 111.7 MiB | at-most 150.0 MiB | PASS | Byte size of the versioned NSIS x64 setup candidate. |
| coldStartMs | 4052 ms | at-most 15000 ms | PASS | Wall time from CreateProcess for an isolated installed candidate to authenticated Receiver discovery. |
| idleWorkingSetBytes | 463.4 MiB | at-most 700.0 MiB | PASS | Sum of WorkingSetSize for the installed Electron Shell process tree after Receiver ready and a 1 second idle settle. |
| activeWorkingSetBytes | 579.1 MiB | at-most 850.0 MiB | PASS | Sum of WorkingSetSize for the same process tree after 300 authenticated OTLP log requests and projection settle. |
| receiverRequestsPerSecond | 388.0 req/s | at-least 75.0 req/s | PASS | 300 authenticated one-record OTLP/HTTP requests at concurrency 16, divided by wall time; every response must be accepted. |

The measurement fails the task when any budget is exceeded. Installer size is the NSIS candidate; memory is the complete installed Shell/Renderer/Desktop Host process tree rather than one convenient process.
