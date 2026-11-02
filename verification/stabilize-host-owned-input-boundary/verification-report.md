# Host-owned Input Boundary Verification Report

## Reproducible subject

- Change: `stabilize-host-owned-input-boundary`
- Tested implementation commit: `d9ae517a0c8b103b94a4ea955ff9762bc298bda5`
- Package: `repoctopus@0.1.0`
- Package bytes: `1115876`
- Package SHA-256: `7cfa0bd033cb30776405a30ffcd46722c82b9d997699f9d1fa27276596c85208`
- Controller: `@rpamis/comet@0.5.1`
- Platform: Windows x64
- Node.js: `24.21.0`

The tested implementation commit is the packaged-product boundary. Later commits may contain only OpenSpec state or verification evidence. `check:managed-execution-report` rejects any later packaged-product change and independently reproduces the npm package checksum.

## Boundary invariants proved

1. Git HEAD, index, tracked modifications and unknown untracked files remain product inputs. A dot-directory or Host brand does not grant an exclusion.
2. Only versioned Repository Input Policy Contributors may classify an untracked file as control-plane input. The compiled policy has a deterministic content digest and rejects unsafe, duplicate or overlapping rules.
3. Git-tracked `AGENTS.md`, `.agents/skills/**` and `skills-lock.json` remain product inputs. Git-tracked `.codex/hooks.json` or `.codex/rules/**` is an external-exclusive ownership conflict.
4. Registered Host inputs are enumerated even when local Git ignore rules hide them. Their relative path, owner, rule, size and content digest enter a separate control-plane manifest; content never enters diagnostics or telemetry.
5. Control-plane collection rejects symlinks, junctions, shared hard-link identities, repository escape, unsafe types, count/size limits and selection or content races.
6. Evidence fingerprint schema v2 and Verification Input schema v3 bind the policy and control-plane digests for every repository. Old active inputs require recollection; no compatibility reader or Archive bypass was added.
7. Architecture governance checks Git/product/package ownership rather than physical path existence. Untracked Host installation files may remain in place, while tracked external-exclusive paths and package leakage still fail.

## Real-worktree input evidence

The following untracked Host inputs remained in the worktree throughout architecture, package and full verification:

- `.codex/hooks.json`
- `.codex/rules/repoctopus.md`
- `.agents/skills/repoctopus-acceptance/SKILL.md`
- `AGENTS.md`
- `skills-lock.json`

On the clean tested implementation commit, `evidence plan --profile verify` produced:

- repository HEAD: `d9ae517a0c8b103b94a4ea955ff9762bc298bda5`
- repository tree: `2587b839d997a70dcd383ea7886e16a7ed91114f`
- product dirty count: `0`
- input policy: `sha256:b1ad289a85d06231b5668a5d9851f6807777e2e045205ad0112f18fb04fe4992`
- control-plane manifest: `sha256:beec11b25ca6c78057a4c2080024bbabc6cf8b301f925d00b6968f591b3c8e6b`
- Evidence fingerprint: `5cd2501fefd17a0a3b1cf1d9ac953d9fc156fde22744e20307641fc7f4aa5e3d`

Changing only `.codex/hooks.json` kept product dirty count at zero, changed the control-plane manifest to `sha256:0d75eb6c4381ed83d71b8731dd3453fa1b467ea08b7ea894da9a1604a330eeae`, and changed the Evidence fingerprint to `494248c753d87b4136e4896468af9bce420c5bf2b1420d3e68f0d68682016597`.

After restoring the Hook, adding unknown `.codex/unknown-product.json` preserved the baseline control-plane manifest, entered the product dirty set, and changed the Evidence fingerprint to `e37834367d6ea1cf409a5ba0a24b220997c72b8648de5862f487b27a61b62b38`. Removing the unknown file restored the baseline exactly. No Host directory was moved and no ignore rule was changed during these checks.

## Commands and results

```text
npm run verify
  TypeScript, Desktop TypeScript, ESLint, CLI build and Desktop build passed
  170 test files passed
  761 tests passed; 2 skipped
  generated output, brand, architecture, provenance and Dashboard salvage passed
  OpenSpec strict validation passed 18 items; 0 failed
  the final report freshness gate correctly rejected the previous package boundary

npm run test:package-e2e
  1 test file passed; 1 test passed
  .codex, .agents, AGENTS.md and skills-lock.json were absent from package files

npx vitest run test/provenance.test.ts test/project-composition.test.ts test/e2e/runtime-tracer.e2e.test.ts
  3 test files passed; 14 tests passed
  the refreshed Comet-derived target digest and composition identity were accepted

npm run check:architecture
  280 production sources and 21 capability owners verified while Host files remained present

npm run check:provenance
  20 Comet-derived files, 60 immutable Cordis files, 33 Matt Skill files,
  8 fixed DSH packages and 5 DSH Desktop references verified
```

The initial TDD runs failed because Repository Input Policy and its registry did not exist. Subsequent focused runs passed policy, fingerprint, multi-repository Coordinator, Verification Input, Archive revalidation, architecture and package boundaries. The complete verification must be rerun after this evidence-only report is committed so the report checker can reproduce the package checksum.

## Diagnostics and telemetry

Ownership conflict, unsupported fingerprint schema, unsafe input, limit and input-drift failures are bounded diagnostics. Existing Evidence and lifecycle telemetry continues to export only allowlisted event fields. Paths, policy owner values, rule text and Host contents are not Metric labels; no second telemetry or lifecycle state was introduced.

## Cleanup

- The temporary npm archive and its directory were removed after hashing.
- The temporary unknown-product file and Hook mutations were restored after each drift check.
- Host acceptance inputs remain only until the Change completes Archive; they are not tracked or packaged.
- No Runtime Store, approval, checkpoint, Git ignore rule or lifecycle state was edited to bypass a gate.

## Verdict

The implementation establishes a deterministic product/control-plane ownership boundary, binds Host execution inputs to existing Evidence and Verification Input identity, preserves fail-closed multi-repository behavior and removes the need to move `.codex` during verification. The packaged product is ready for the report checksum gate, Comet Build Check and independent Verify review.
