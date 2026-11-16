# Archive publication policy verification

Tested implementation commit: `83b012dc33184ba1da4732c6f528ed0706ca6026`

Package content SHA-256: `2c364551bdd99a8f1aa221615de6fecf2848d76af3ee82db0dfe58956a7e1c3b`

Package files: `487`

Package content bytes: `6576162`

## Reproduction and fix

With a custom API base, the Archive integration test recorded the business PR POST at the configured API and the specification PR POST at `api.github.com`. The default endpoint case passed. The regression exercises the real GitHub request adapter and captures final URLs at its HTTP boundary. It also simulates a lost response after a business PR was created, then resumes the same Journal after observation becomes available.

WorkflowRuns passes the validated Delivery Policy to both publication paths. The file Delivery provider constructs both clients from the same API base and credential reference. A deliberately changed API URL is rejected before any HTTP request or remote ref change. The two modified plugins identify the exact earlier acceptance package as their compatible predecessor under the existing state contracts.

Independent review found that explicit `--policy` and Workspace YAML could name different credentials. In the second RED run, the adapter sent the Workspace credential for both a policy that explicitly named a different reference and a policy that omitted the reference. Both tests pass after selecting credentials from the checked policy. A policy without an explicit reference uses the existing `GITHUB_TOKEN` default. The reviewer checked the fix and found no remaining blocking findings.

33 focused checks passed, including the custom and default API cases, specification publication, the GitHub client and compatible-composition checks. Type checking, lint, architecture, upstream provenance and strict OpenSpec validation passed.

## Installed Windows package acceptance

The [acceptance receipt](acceptance-receipt.json) identifies the endpoint-repair package used to resume the two original five-repository Runs and the final package used for credential verification. Git pushes use real loopback smart HTTP and bare remotes. The local HTTPS fixture observes PR requests. A subprocess preloader rejects any other API origin or path, redirects, and authorization other than the dedicated test credential. The test keeps the actual Git and HTTPS transports.

| Round  | Existing facts retained                                                                         |      MR create requests | Git receive-pack requests | Cold terminal calls |
| ------ | ----------------------------------------------------------------------------------------------- | ----------------------: | ------------------------: | ------------------: |
| Normal | Business PRs 1 and 2, previously pushed specification OID                                       | 1 for the specification |                         0 |                   4 |
| Repair | Original backend completion, repaired frontend completion, original Verify evidence and Closure |                       3 |   1 for the specification |                   4 |

Both original Run IDs reached `completed`. The checks compared Plan, package completions, Verify Input, Bundle, Archive Input, and Closure before and after resumption. The final receipts match remote refs and PR identities. The repair round records two executions and two Verify runs for frontend, and one of each for backend. The ordinary round records one of each per repository. Each terminal call returned `done` and preserved the Run, checkpoint and trajectory bytes and both execution counts. Request ingress includes every creation or Git write attempt, even attempts a fixture would reject.

The final installed package repeated four cold terminal calls for each original Run. The same Runtime file hashes and PR receipts were retained. The request ingress file was unchanged. A separate five-repository Run used the final package from onboarding through Archive. It passed an explicit policy file to both Archive commands. The policy and Workspace declared different environment variable names. The transport assertion accepted only the fake credential selected by the explicit policy. The new Run completed with three PR creates, 28 API calls, and four cold terminal calls.

The acceptance scope covers an isolated GitHub-compatible HTTPS fixture and its configured Git remotes.
