---
name: repoctopus-configure-verify
description: Configure or repair the automatic Verify Profile in an existing Repoctopus Workspace, including when a Run is waiting for verification setup.
---

# Configure Repoctopus Verify

Work at the configured Workspace root. Use the installed `repoctopus` CLI (`repoctopus.cmd` in Windows PowerShell). If the user is continuing a Change, preserve its Run ID and use the acceptance inputs returned by Runtime.

1. Read `repoctopus.yaml` and the selected repositories' actual build and test configuration. Use real executables, exact argument lists, repository IDs, dependency order and justified acceptance coverage. Ask when ownership or coverage is unclear. The Workspace guide links to the shared config schema and examples.
2. Prepare a local file containing the selected Profile object (`id` and `nodes`). Run `repoctopus project configure-verify --candidate <file> --json` to get the candidate and approval request. Include `--run <run-id>` when continuing a Run with approved Acceptance criteria. Show the exact commands, repositories and coverage. Preserve unrelated configuration.
3. Wait for the real user decision. Submit it to `repoctopus project review --request <request-file> --response-file <response-file> --json`. The response has `kind: HumanDecisionResponse`, the request's `apiVersion`, `requestId`, `snapshotDigest`, and the user's `decision`.
4. Follow the team's Git policy to record the approved configuration. When a Run was waiting, continue that Run with `repoctopus run resume --run <run-id> --json` and the Runtime's continuation. Only report Verify passed when Runtime accepts the actual verification evidence.
