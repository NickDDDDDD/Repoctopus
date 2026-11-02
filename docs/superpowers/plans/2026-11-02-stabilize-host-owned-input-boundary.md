---
change: stabilize-host-owned-input-boundary
design-doc: openspec/changes/stabilize-host-owned-input-boundary/design.md
base-ref: a0a0aec97d85203e3f31d518d34398259d0ec831
---

# Stabilize Host-owned Input Boundary Build Plan

<!-- comet-task-authority: openspec/changes/stabilize-host-owned-input-boundary/tasks.md -->

## Execution contract

本计划是已批准 Design 的执行投影。任务文本、完成状态与稳定 ID 只以 `openspec/changes/stabilize-host-owned-input-boundary/tasks.md` 为权威；本文件不建立第二套任务清单。实施固定为 `autonomous + tdd + thorough`，沿用已批准 worktree，不启动子代理。行为任务先建立真实 RED，再提交最小 GREEN；文档、纯结构整理和最终验收不伪造 RED。

实现只增加一条 Repository Input Policy → product/control-plane fingerprint → Evidence/Verification Input 链，不新增生命周期状态、Archive 特判、临时搬移或 ignore 绕过。若触发 Design 的 Stop Conditions，停止执行并返回 Design。

## 1. 固定失败基线

<!-- comet-task-ref:6177f05b-f960-4bb7-bdc2-406a19b626d0 -->

**1.1 Fingerprint 分类 RED。** 用临时 Git 仓库固定 registered control-plane、unknown untracked、tracked dual-use 和 external-exclusive conflict 四类输入；失败必须来自当前实现没有分类能力。

<!-- comet-task-ref:1961826d-da2d-431b-91c5-85786b49c64d -->

**1.2 Architecture RED。** 以子进程运行真实架构检查，证明未跟踪 `.codex` 当前因 `lstat` 误失败，同时 tracked/index/package 产品面仍应失败。

<!-- comet-task-ref:67179a4b-7d9f-4131-9bba-5d6071ba3fc2 -->

**1.3 Gate 纵向 RED。** 从 Evidence fingerprint 到 Verification Input 和 Archive stale check 固定“Host 不变可复用、内容或策略变化失效”。

## 2. 领域 Policy 与 Contributor

<!-- comet-task-ref:c90430a3-777d-40ae-ab4a-5d6ec2f33131 -->

**2.1 纯 Policy 值对象。** 在领域层定义 schema、provider identity、受限 path rule、owner、ownership、file kind 与规范 digest；拒绝绝对路径、`..`、重叠和不稳定大小写。

<!-- comet-task-ref:37a3b58c-922a-4ebb-b99f-66610c4afe0f -->

**2.2 Registry 与编译。** 建立 Cordis registry，规范排序 Contributor、拒绝重复 owner/rule，并编译默认拒绝策略。具体 Host 名称只进入插件实现。

<!-- comet-task-ref:ac22246d-bc5b-40ab-98c1-93509d613861 -->

**2.3 Composition identity。** 把 Contributor 插件代码、descriptor 和配置摘要纳入现有 composition；恢复时沿用现有 compatibility/migration 机制。

## 3. Git 输入分区与安全哈希

<!-- comet-task-ref:154d2563-b47d-43c3-aaff-f55b2b2c1e0c -->

**3.1 稳定选择。** 一次选择 HEAD/tree、tracked changes、unknown untracked 和 policy 限定 control-plane；显式枚举已登记规则，使本地 ignore 不能隐藏执行输入。

<!-- comet-task-ref:1495f29c-8024-428a-96ec-dd7ea02276cb -->

**3.2 Race-safe manifest。** 复用文件身份、symlink 与 root containment 校验，首次/最终选择共同核对集合和内容。

<!-- comet-task-ref:10bf45ea-696b-48a6-8bc5-a3552fc080f5 -->

**3.3 Fingerprint schema v2。** Repository fingerprint 保存 policy 与 control-plane manifest；Evidence manifest 直接升级 v2，旧开发 Evidence 明确失效。

<!-- comet-task-ref:22e9ab60-c2b9-4348-8a15-45319cc15a84 -->

**3.4 Product dirty 回归。** 保持 tracked modification/deletion 与 unknown untracked 的现有内容摘要语义，点目录和 Host 品牌不构成隐式排除。

<!-- comet-task-ref:dc2238c3-3051-4dd2-8599-3f6c717ac621 -->

**3.5 资源上限。** 对文件数、单文件和 manifest 总大小设置常量上限；诊断只含类别、规范相对路径和摘要，不含正文。

## 4. Evidence 与 Verification Input 纵切

<!-- comet-task-ref:a2ed6786-07a6-4f01-93d4-031b064aec90 -->

**4.1 Coordinator 接线。** EvidenceCoordinator 只从 registry 取得已编译 policy，并逐登记仓库采集；路径规则不进入协调 Service。

<!-- comet-task-ref:7256394a-895f-4741-af64-fc0b4cb2a3e3 -->

**4.2 Verification Input v3。** 将每仓 policy/control-plane digest 贯通 Receipt reuse、Bundle、Gate 和 Verification Input；不建立旁路状态或旧 schema 兼容。

<!-- comet-task-ref:631f77ce-2fb0-4ff8-9d29-36ecba6e7d38 -->

**4.3 Archive 重验。** 复用现有冻结输入比较，Host 不变不刷新 Verify；内容变化进入现有 stale/repair。

<!-- comet-task-ref:c4c8f673-6eee-49e1-a3eb-62f250848f1f -->

**4.4 删除 workaround。** 搜索并删除或修正文档、测试和代码中的搬移、临时 ignore 与 fingerprint 绕过假设。

## 5. 架构与发布边界

<!-- comet-task-ref:1a64d8fd-ba25-49fc-bd2c-41ee85fb3051 -->

**5.1 产品面治理。** 将 forbidden path 的 `lstat` 改为 HEAD/index/source/package 检查；未跟踪物理存在不再单独失败。

<!-- comet-task-ref:17d2c8c9-810e-4b75-b8a0-af3ac4a5de2f -->

**5.2 治理回归。** 保留 marker 和 capability ledger 检查，覆盖 staged、tracked、生产引用、不安全类型、包泄漏和合法 dual-use tracked。

<!-- comet-task-ref:5ec5a296-28b2-480d-8671-795c55159fc6 -->

**5.3 最小 Host rules。** 插件层仅登记本次有证据的 Hook/rules、Skill installation、Agent instruction 和 lock；未知 `.codex/**` 保持 unknown product dirty。

<!-- comet-task-ref:04bbdc62-3d38-4d27-a9ab-83d8aa4fa09c -->

**5.4 包边界。** 用真实 architecture 与 package E2E 证明 Host 文件不进入发布包且产品不依赖外部 Host。

## 6. 多仓、安全与诊断

<!-- comet-task-ref:eb97ab6b-416f-4030-91cf-2bfe594c2603 -->

**6.1 多仓。** 每仓独立生成摘要，再按 repository id 聚合；覆盖 override、sibling worktree 与单仓漂移。

<!-- comet-task-ref:112f5e34-9582-44a0-a033-b7279b4f3b07 -->

**6.2 Windows 与路径攻击。** 覆盖大小写、junction/symlink、跨 root 同文件对象和采集竞态，绝不读取 root 外正文。

<!-- comet-task-ref:2133f1dc-1d6a-4d12-813a-ead27c827b52 -->

**6.3 有界诊断。** 复用现有 Evidence/Runtime 诊断与遥测，只输出固定类别和计数；不把路径、owner 或内容作为 Metric label。

## 7. 文档与真实验收

<!-- comet-task-ref:ea516def-e9df-4e8a-8ab8-52a59f167811 -->

**7.1 边界文档。** 解释 product、control-plane、runtime-state 和 unknown，删除移动 `.codex` workaround。

<!-- comet-task-ref:71f2a332-7166-48e3-9c6f-e5097665eedc -->

**7.2 原位自举。** Host Hook、Skill、Agent instructions 和 lock 全程原位运行 Verify→Archive 输入重验，保存正式 Evidence。

<!-- comet-task-ref:c9d61332-45f4-4b46-8cf6-bfe2850f6a48 -->

**7.3 漂移验收。** 分别改变 control-plane 文件和新增 unknown 文件，证明由不同摘要使旧 Bundle 失效，再恢复工作树。

<!-- comet-task-ref:8c6cedb2-4245-4c45-bd23-92faf9acc5a0 -->

**7.4 最终检查。** 执行 `npm run verify`、package E2E 与 OpenSpec strict validation；只有 26/26 Task、计划映射和全量验证均通过才提交 Build completion。
