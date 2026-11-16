# Runtime output cleanup recovery

Tested implementation commit: `b6f000dfe43d23202457d6f07f50cc920b9c7008`

Package content SHA-256: `2fe3d77ba723d82c06ff08ddd6d4d8a87fee31c76a667cc2d42f3e50bec03896`

Package files: `487`

Package content bytes: `6576092`

## Reproduction and recovery

The baseline npm package was built from `b6a33525a3db152eaa8b2547cf930a1d2f0f7391`. In a Windows Workspace with two business repositories, it accepted Build Configure while a generated file was tracked. After a deletion-only untracking commit, cold `resume` and `next` both reported `unaccepted-head` and retained the same Execute Work. The baseline `work-reconcile` reported that no relevant Host invocation needed reconciliation.

The candidate checks the Git index and HEAD before accepting initial Bindings. The diagnostic names the repository and path. A cleanup-only commit allows the submitted Configure candidate to advance the original Run. For bound Runs, the same Workspace checkout and a deletion-only direct child of the accepted HEAD establish the Git proof. Runtime checks current planning authority, reobserves under the guarded operation, and updates the checkpoint and same-package Work in one journaled transition.

When the previous package already completed, the Workspace can contain Runtime's unstaged task checkboxes. The provider supplies the official Tasks path and current digest. Runtime reconstructs the permitted checkbox edits from accepted package facts and the verified Git blob. The guarded commit preserves the original package completion. Temporary Provider failures produce a retryable observation, including during final revalidation. A clean checkout requires no extra Tasks projection query.

## Verification

The [acceptance receipt](acceptance-receipt.json) binds the installed Windows archive to the cold CLI recovery, Git identities, and actual Build and Verify results. The experiments use isolated local Git remotes.

The 31 focused tests cover Git index and HEAD tracking, mixed commits, staged changes, hidden worktree edits, and the exact task projection. Guarded Run tests cover mismatched blocker ownership across repeated pulls, concurrent acceptance, stale observation, unresolved execution, and journal replay. Type checking, lint, architecture boundaries, and Comet source provenance passed.

Independent review found that an existing blocker could acquire new provenance, and that a temporary Provider failure could be mistaken for a Git conflict. The final review confirmed the fixes, including the immutable Git blob used to reconstruct the task projection. Cleanup OIDs and proof digests stay on the trajectory. The lifecycle telemetry projection uses fixed transition and Work attributes and adds no path or OID labels.

Comet runs the complete product checks with `npm.cmd run verify` and records its result in the same Change Run.
