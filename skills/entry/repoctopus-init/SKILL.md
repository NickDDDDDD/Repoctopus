---
name: repoctopus-init
description: Initialize a new single-repository or multi-repository Repoctopus Workspace when the user asks to set up Repoctopus.
---

# Initialize Repoctopus

Use the installed `repoctopus` CLI (`repoctopus.cmd` in Windows PowerShell). Start from a Git repository root. Use `--json` and pass paths as separate arguments, quoting paths with spaces.

- Use the host's explicit selection value: `codex`, `opencode`, `codebuddy`, `codearts`, `trae` (international), or `trae-cn` (China). If you cannot identify the user's host or edition, ask them to select it.
- For a single repository, run `repoctopus project init --layout single --entry-hosts <host>` from the repository root.
- For multiple repositories, use the separate Workspace Git root. Run `repoctopus project init --layout multi --scan-root <parent> --entry-hosts <host>`. Use `--repositories <comma-separated-ids>` to restrict it to the intended business repositories. If the layout or selection is ambiguous, obtain the user's selection. `project detect --layout multi --workspace <workspace> --scan-root <parent> --json` lists the available repositories without changing team configuration.
- Show the Runtime's plan: Workspace, repository paths, Store, business pointers and Skill installation targets. Ask for a real choice. If required, read the request again with `repoctopus project decision --request <file> --json`.
- After the user answers, put a `HumanDecisionResponse` JSON object in a local temporary file. Copy the request's `apiVersion`, `requestId` and `snapshotDigest`. Set `kind` to `HumanDecisionResponse`, and `decision` to their choice of `approve`, `request_changes` or `reject`. Use `repoctopus project review --request <file> --response-file <response> --json` from the same Workspace. Wait for the user's answer before submitting. An interrupted review can reuse the same request and response.
- Report the result and any diagnostics. After approval, the workspace `repoctopus` skill can start the first Change. Verify can be configured separately with `repoctopus-configure-verify`.
