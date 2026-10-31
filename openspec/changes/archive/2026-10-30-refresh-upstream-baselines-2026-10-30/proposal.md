# Proposal

## Why

每日上游漂移检查发现 Repoctopus 固定的 Comet `0.5.0` 与 DSH `0.2.1-rc.3` 已落后；同时 Comet 与 DSH 的默认分支都已越过最新发布标签。继续让一个 `pinnedCommit` 同时表达“可复现发布基线”和“最近审计的分支头”会在两者分叉时制造错误来源关系，因此需要先刷新发布基线，并把这两种身份明确分开。

## What Changes

- 把 Comet 可复现源码基线升级到发布标签 `0.5.1` / `35c9860b77b42bafa0c2d80d8d695889f888a924`，并独立记录本次审计的 `master` 头 `4901cac9330f5ffe289abfa6daf8412bfa190dc0`。
- 把 DSH 发布依赖与相应来源基线升级到 `dsh-v0.2.1-rc.5` / `b830ec950faba0a46dda564be3e2d854afed94f1`，并独立记录本次审计的 `master` 头 `ce7073d51254c26cd63b22a60835b8f948deb447`。
- 将上游基线账本从含糊的 `pinnedCommit` 改为明确的发布标签提交与已审计分支提交，令漂移检查和 provenance 检查各自验证正确身份。
- 对两个上游从旧发布基线到新发布基线、以及新发布标签到当前默认分支的增量做完整审计，逐项记录采用、拒绝或延后；本 Change 只落地来源、依赖和审计基线，不顺带实现新的产品行为。
- 刷新 Comet 派生文件的上游来源摘要、DSH/Cordis 固定来源、依赖锁文件、采用报告和架构引用，并以 provenance、漂移检查和全量验证证明基线可复现。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。本 Change 只调整内部上游治理、固定依赖和来源证据，不改变用户或下游系统可观察的规格行为；`.openspec.yaml` 因此设置 `skip_specs: true`。

## Impact

- 上游治理：`third_party/upstream-baselines.json`、`scripts/check-upstream-drift.mjs`、`scripts/check-provenance.mjs` 及其测试。
- Comet 来源与审计：`third_party/comet/source-manifest.json`、采用报告、新版增量审计和架构说明。
- DSH/Cordis 来源与依赖：`third_party/dsh-adoption.*`、`third_party/cordis-upstream.*`、固定快照、`package.json`、`package-lock.json` 与相关检查账本。
- 不改变 Repoctopus 公共 API、五阶段生命周期、Specification Provider 或产品运行时行为；上游发现的可靠性改进进入后续独立 Change。
