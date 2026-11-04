# Proposal

## Why

第五轮真实多仓验收证明核心生命周期可以完成，但暴露了两个会误导恢复行为的 Runtime 缺陷：

1. GitHub 明确拒绝 MR 创建请求时，当前实现仍把所有异常包装成“结果未知”。Journal 因而进入只允许观察的 `mr-unknown`，即使平台已经证明本次请求未执行，修正凭据或配置后也无法在同一稳定 publication identity 上安全重试。
2. Run 已经 `completed`、Archive 已无 current Work 时，公开 continuation 仍可能被旧的 `workId=null` `continuation.selected` 事件覆盖成 `wait/transition-pending`，导致 CLI、Desktop 和遥测把终态显示为仍在推进。

这两个问题都来自把不同证据强度压成同一种投影：前者混淆“确定未执行”和“执行结果未知”，后者让历史选择覆盖当前终态。它们必须在继续扩大验收范围前修复。

## What Changes

- 为平台副作用失败建立有界的执行确定性分类：只有平台明确拒绝且证明未执行的请求可以回到可重试状态；传输中断、5xx、成功响应不可解析或创建后核验失败继续视为结果未知。
- 让 Business MR Publication Journal 在确定未执行时保留原稳定 intent、attempt 和诊断并回到安全可重试 checkpoint；未知结果仍只允许观察、采用或人工修复，禁止盲重放。
- 让 GitHub Adapter、Delivery 服务、Journal 和 CLI 保留同一低基数错误分类与可操作恢复说明，不泄露凭据或把任意平台消息写入 Metric labels。
- 让 Run 的 terminal status 在 continuation 投影中拥有绝对优先级；历史 `continuation.selected` 不得把 terminal checkpoint 改写为等待态。
- 增加平台分类、Journal 恢复、终态投影、打包 CLI 和第五轮验收形态的回归测试。

## Capabilities

### Modified Capabilities

- `delivery-governance`：区分确定未执行与结果未知，并按证据强度恢复稳定 MR 发布。
- `change-lifecycle`：保证 terminal Run 的 continuation 与 next actions 由当前权威 checkpoint 决定。

## Non-Goals

- 不对未知外部结果自动重试，不通过递增 generation、改变 publication identity 或新建 Run 绕过恢复。
- 不等待 MR 合入，不增加 webhook、守护进程、自动 merge、force push 或远端分支删除。
- 不改写既有 Journal/Trajectory 历史，不通过手工 Store mutation 修复状态。
- 不在本 Change 更新 Comet/DSH 固定基线；只记录本次检查到的上游漂移并继续采用 Comet 0.5.1 的稳定恢复原则。

## Upstream Reference

参考固定 Comet 0.5.1（`35c9860b77b42bafa0c2d80d8d695889f888a924`）的成熟边界：未知副作用不重放，先协调原执行；只有存在 `not-executed` 证据才允许重试；terminal status 是权威事实。Repoctopus 在自身多仓 Publication Journal、不可变 Work 和 OpenSpec 权威模型中独立实现，不复制 Comet 的单仓数据结构。

2026-11-04 的漂移检查显示 Comet `origin/master` 已到 `ff64a75cc51d68b57218c6ce7fad94a7383b9a76`、DSH HEAD 已到 `8bd073392eef6f54e921a093b95076248eb08cbb`；检查到的 Comet 变更未改变上述恢复原则，因此本 Change 不混入上游基线升级。

## Third-Party and License

本 Change 仅参考 Comet 的公开行为、文档和恢复边界，在 Repoctopus 架构中独立实现，不复制第三方源码或新增依赖。
