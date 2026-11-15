---
comet_change: repair-spec-validation-authority
role: technical-design
canonical_spec: openspec
---

# Design

## Context

阶段审批已经各自绑定规划语义与当前提案。早期的 `specification.validate` 命令在 Provider 返回后调用通用 Run 绑定，CLI 此后才检查有效性。Open 和 Design 也依赖这条单独写入路径，并把首个校验摘要当作整个 Run 的固定值。候选包复现了校验失败卡住原 Run、两份有效草案之间出现漂移，以及另一个 Change 的校验摘要写入当前 Run。

另一个入口差异出现在后续规划观察。`observeAuthority` 将调用异常表示为 `invalid/unknown`，Verify 恢复路径识别这个组合，Build 恢复和 Archive 准备的部分调用方却把它送入 Design 修订。

## Goals / Non-Goals

- 让手动严格校验、受管 Open/Design 接受、Provider 兼容检查各自使用对应的输入和写权限。
- 让暂时不可用与确定性规划失效走一致的分支，并保留已有的多仓、证据和发布保护。
- 本次范围覆盖 Specification 命令、规划观察、Open 和 Design 提交，以及受影响的 Build、Verify 和 Archive 入口。历史 Run 中无法证明来源的绑定保留作为原始证据。

## Decisions

### 1. 手动校验通过只读身份核对

`spec validate --run` 先从 Runtime 的只读 Run 入口读取归属，核对 Workspace、Run 和 Change。无法读取、非 Change Run 或身份不匹配时停止。匹配后调用严格校验，以现有 CLI 退出码和 JSON 协议返回结果或能够定位工件的诊断。校验输入相同或不同都不提交 Run、checkpoint、审批、规划快照或已接受证据。使用现有 Provider 校验方式，对调用者返回真实失败。

对其他绑定入口做同一检查。移除只供旧命令使用的通用规格绑定入口。当前 `specification.prepare-closure` 可以在 Provider 层计算候选，但可选 Run 写入不参与正式 Archive，去掉这条发布快照的旁路。Archive Work 仍以受管前置条件、Closure Receipt 和 Publication Journal 核对实际关闭和远端效果。

### 2. 通过阶段转换提交有效证据

在现有 `acceptChangeObservation` 受保护提交中，让获准的 Open 和 Design 转换携带最小的阶段接受证据。核对 Run 和 Change、阶段与生命周期 revision/checkEpoch、当前适用的 Work 或 Wait、可信批准请求和提案摘要，并重新观察 Provider、规格根和批准所指工件。重新观察使用只读入口。旧 revision、工件不匹配或快照未通过严格校验时，沿现有阶段恢复处理，不接受该候选。

在同一次 Run Store 提交中记录阶段转移、最小的已接受 Provider/校验身份和其轨迹。复用现有 `SpecificationUsageSnapshot` 作为最近一次已接受规格证据的投影，原 Open/Design 证据通过现有生命周期事件保留。它的校验摘要只描述接受它的阶段输入。合法 Design 或重新批准的 Design 可产生新摘要。原有 Provider id、版本、协议与受保护 Work 的 Provider 检查继续生效。确定性规划漂移仍使用现有 planning semantic identity 和当前批准判定。

采用这条路径是因为现有 Run Store 和生命周期事件已经具备提交边界。仅增加 `validation.valid` 条件会留下有效草案提前冻结的问题。另建阶段证据 Store 会要求协调第二份状态，增加中断后的不一致风险。Comet Classic 0.5.1 的 `recordEvidence` 也在证据有效且待接收项匹配后才提交同一 Run。

### 3. 分清观察不可用和规划失效

用可区分的观察结果表示 `authorized`、`invalid` 和 `unavailable`。只有确凿证实的工件无效、语义差异或批准失效可以进入现有 Design 修订分类。Provider、Store 或验收进程无法给出可靠结果时，保留阶段、revision、Work、审批、已接受包、Gate 和 Bundle，并返回可重试的重新观察诊断。

统一检查 Build 恢复与 Configure/Plan 的只读规划核对、Verify 运行或恢复、Archive 准备与副作用前检查。消费当前观察的入口必须短路等待，避免继续使用一次失败的观察创建 Work。已明确开始的 Archive 操作继续遵循既有 Journal 对外部结果的核对顺序。确定性失效沿用现在的 `revise-design`，并保留精确依赖失效逻辑。

## Risks / Trade-offs

- **并发与中断**。Provider 校验完成后，另一 Host 可能推进批准或 Work。单次提交仍核对当前阶段身份，过期或失败提交不留下提前绑定。成功后响应丢失时复用已接受事实，不重复派发。
- **已部署输入**。旧初始快照缺少校验成功事实和阶段来源。保持其历史记录供定位，本 Change 验收使用正常公开入口生成与恢复 Run。若持久化身份根本不兼容，沿用 Runtime 的现有诊断。
- **调用者预期**。CLI 调用方式与退出码保持可用，`--run` 的写入效果收敛为只读，且用户指南同步。正式 Archive 继续使用其现有发布身份和证据。

## Verification

- 先让公开 CLI 回归对旧实现失败。覆盖无效后修正、两次有效草案、Change A 配 Run B，以及读取完成 Run 不改写历史。
- 在提交边界覆盖生成候选后的中断、两个 Host 使用同一版本竞争、旧审批被拒和成功后重放。测试 Open 与 Design 使用不同有效摘要，还要覆盖 Build 带合法 Design 调整返回同一 Run。
- 注入 Provider 暂不可用，对比 Build Configure/Plan、Verify、Archive preflight 与 publish 的阶段、Work、批准和副作用计数。恢复 Provider 后继续原 Work。确定性规划变更继续进入 Design。
- 以实际安装包走多仓公开 CLI，从失败校验修正到同一 Run 的 Open、Design、Build、Verify 和 Archive。复验复选框提交保留 Verify 证据、真实远端发布和终态恢复不重复发布。
