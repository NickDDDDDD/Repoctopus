# Host decision candidate package binding

Tested implementation commit: `fdf04962a017259311b562c0c9795772c0512885`

Package content SHA-256: `612ebd11255374c104fd91ad8fa45676567d35cab8572d698667c96f2c9ec802`

Package files: `476`

Package content bytes: `6144521`

The [verification narrative](../../docs/superpowers/reports/enable-host-mediated-human-decisions.md) distinguishes task-level checks from formal Guard receipts. The package was independently installed and resumed an isolated three-repository Run from a fresh process. Two real native user answers independently approved Open and Design. Cold query/replay retained the original decisions; replay of the old Open answer during Design and the Design answer during Build left the entire Run state unchanged. The experiment stopped at unclaimed Build Configure, with all three registered branches retained and no delivery. The [acceptance receipt](acceptance-receipt.json) binds those facts to this exact package. This file does not replace a full Comet Guard receipt.

Archive SHA-256: `a00f5763555e30d4055d36fc8f6635252c6ff62a56f889950f55289947c72562`.

The earlier package built at `1e9f045` is retained separately. The final canonical audit checked 466 tracked package files against their exact Git blobs and independently installed files, with zero mismatches in either comparison. The final package was rebuilt at the commit above after a CLI type declaration and test-consumer correction; no authority or execution behavior changed in that follow-up.

The archive and native acceptance were built at packaged implementation `1366973f23098ff5ca3c9629895d1bc149ed2dc4`. The tested commit above additionally corrects four existing test fixtures/expectations and preserves the first failed Guard receipt. Its packaged product files are unchanged; the exact package-content gate remains mandatory. The first complete test run had 1205 passed, four failed fixture assertions and five skipped; the four corrected suites then passed 68 tests. Neither the partial first run nor this binding is a declaration of a passed final Guard.
