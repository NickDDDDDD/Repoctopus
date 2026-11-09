# Selective Verify repair: installed package binding

Tested implementation commit: `7f9b38b30f96b9957a6856ffeb3ded8a132a609c`

Package content SHA-256: `9407874f194d51dead05fb13ec03c7045c040db59917cdd115bcccfe365f8cbd`

Package files: `472`

Package content bytes: `6076777`

## Evidence and scope

The [verification narrative](../../docs/superpowers/reports/preserve-build-completions-on-verify-repair.md) records the actual RED/GREEN checks, independent review and two fresh five-repository CLI experiments. The [acceptance receipt](acceptance-receipt.json) records the final experiment: unchanged Plan and B/C/D completions, A-only implementation repair, execution and machine-check counts A=2/B=1/C=1/D=1, four cold recovery boundaries and unauthorized-branch rejection.

The full experimental archive has SHA-256 `635980c0d5aeee8b60cf78d72da0b71d776c1b87a23dedfa0ffcd3c2c4baf295`. The complete-build archive bound above has transport SHA-256 `ee16316f5ef4e2c587deddbcaadbcb0a505a0d4d116b4701159c334963909e63`. These are distinct archives: complete Build adds seven desktop resource files; the only modified existing entry is an adoption-report heading. File-by-file comparison proves all existing Runtime, CLI and Skill bytes identical; see [package comparison](package-equivalence.json). This is not a claim that the archives are interchangeable in every respect.

The bound archive was independently installed using npm with lifecycle scripts disabled. Its public CLI resumed the final experimental Run in a fresh process, and the acceptance operator reasserted the unchanged completion objects, Plan, Task facts and execution counts. Its public `doctor --run` also passed. The shared CLI SHA-256 is `9efe3e7390a83aa0c255ce6933783a0c1672f7e13e6f9b49469c217735337358`.

Raw archives, independent installations, Run records, comparison script, doctor output and command logs are preserved under `C:/Users/User/Desktop/PP/repoctopus-verify-repair-evidence-20261109`. The desktop resources are covered by the repository's full Verify checks; this package binding does not claim a new interactive desktop or Archive/publication experiment. Formal Comet Guard receipts remain authoritative for final phase validation. No Release is in scope.
