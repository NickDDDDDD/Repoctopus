# Host decision candidate package binding

Tested implementation commit: `a781a230311c084766745f3f899aa68f44d48927`

Package content SHA-256: `612ebd11255374c104fd91ad8fa45676567d35cab8572d698667c96f2c9ec802`

Package files: `476`

Package content bytes: `6144521`

The [verification narrative](../../docs/superpowers/reports/enable-host-mediated-human-decisions.md) distinguishes task-level checks from formal Guard receipts. The package was independently installed and resumed an isolated three-repository Run from a fresh process. Two real native user answers independently approved Open and Design. Cold query/replay retained the original decisions; replay of the old Open answer during Design and the Design answer during Build left the entire Run state unchanged. The experiment stopped at unclaimed Build Configure, with all three registered branches retained and no delivery. The [acceptance receipt](acceptance-receipt.json) binds those facts to this exact package. This file does not replace a full Comet Guard receipt.

Archive SHA-256: `a00f5763555e30d4055d36fc8f6635252c6ff62a56f889950f55289947c72562`.

The earlier package built at `1e9f045` is retained separately. The final canonical audit checked 466 tracked package files against their exact Git blobs and independently installed files, with zero mismatches in either comparison. The final package was rebuilt at `1366973` after a CLI type declaration and test-consumer correction; no authority or execution behavior changed in that follow-up.

The archive and native acceptance were built at packaged implementation `1366973f23098ff5ca3c9629895d1bc149ed2dc4`. The first complete test run had 1205 passes, four fixture assertion failures and five skips. After the fixture corrections in `fdf0496`, the full local Comet Verify passed 1210 tests with five skips. The [verification narrative](../../docs/superpowers/reports/enable-host-mediated-human-decisions.md) records the formal Guard receipts.

[PR #83 CI](https://github.com/NickDDDDDD/Repoctopus/actions/runs/42930830865) first hit the Linux lifecycle matrix’s six-minute timeout and then exposed a race in a pre-existing Evidence interruption test. The tested commit above isolates the interrupted producer from a concurrently executing independent node in the two recovery fixtures and applies the existing Windows ten-minute budget to the lifecycle matrix on all platforms. These test-only changes preserve the packaged implementation and its exact package-content gate.
