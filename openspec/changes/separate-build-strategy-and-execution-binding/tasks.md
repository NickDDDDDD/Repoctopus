# Tasks

## 1. 固定退化基线

- [ ] 1.1 为 Build Configure 重复批准、Host/checkout/HEAD 变化触发新决定、Verify 返工重复询问和 Plan 未预检 scope 增加历史旅程 red tests。 <!-- comet-task:05cd2200-79a6-4d1a-9d6b-e4d81dc8d0b8 -->
      **Acceptance:** 新测试分别证明四类旧行为会失败，且失败原因绑定重复决定、机器事实漂移、返工复用或缺失 preflight，而不是无关环境错误。
- [ ] 1.2 定义 `BuildStrategy`、`ExecutionBinding`、独立 digest/失效规则和预发布 schema 切换；运行领域单测。 <!-- comet-task:72e19e09-c249-43ad-bf86-b22f48ee075b -->
      **Acceptance:** 领域测试证明 Strategy 与 Binding 使用独立身份、摘要和失效规则，旧可写 `BuildConfiguration` schema 不再进入生产路径。
- [ ] 1.3 在不改变行为的前提下拆分主规格中超长的“规划授权失效必须原子恢复 Design checkpoint” Requirement，使全仓 OpenSpec strict validation 恢复为通过。 <!-- comet-task:3d26f41d-6da4-41a4-92b8-b31a78230db5 -->
      **Acceptance:** `openspec validate change-lifecycle --type spec --strict` 与 `openspec validate --all --strict` 都通过，拆分后的 scenarios 与原有授权、精确失效和权威正交语义一致。

## 2. Strategy 与 Design approval

- [ ] 2.1 从 Open/Design 输入产生完整 Strategy proposal，并把 Strategy 摘要纳入 planning snapshot 与 Design approval；运行 planning authority 与 composition compatibility tests。 <!-- comet-task:a04416b0-35c3-4bd8-8d7d-773688926156 -->
      **Acceptance:** Planning authority 测试证明 Design proposal 和批准绑定完整 Strategy；composition 实现身份不进入 approval semantic digest，兼容 adoption 不刷新批准，不兼容变化进入 `migration_required`。
- [ ] 2.2 实现 `decisionKind + semanticDigest` 创建、复用、supersede 和失效规则；运行重试、恢复、返工和真实语义变化测试。 <!-- comet-task:f1718834-e265-4284-bb8e-c04e5529e2cc -->
      **Acceptance:** 重试、恢复和同摘要返工只记录 reused；真实语义变化建立唯一新决定并把旧决定标记 superseded。

## 3. Binding 与 Build Configure

- [ ] 3.1 将 Configure 改为只解析/验证 ExecutionBinding，覆盖 current/branch/worktree、多仓 ownership、Host capability 和本地路径隔离。 <!-- comet-task:f01879d2-0ca9-4f01-8079-a347df6b1af6 -->
      **Acceptance:** Configure 测试覆盖三种 isolation、多仓 ownership、兼容与不兼容 Host，并证明绝对路径只存在本地 overlay。
- [ ] 3.2 删除旧 BuildConfiguration approval 生产路径和未发布兼容执行分支；运行架构边界与恢复测试。 <!-- comet-task:981953df-9058-4f29-a3b4-da5eac884f51 -->
      **Acceptance:** 定向搜索和架构测试证明没有旧配置批准生产入口或双写协议，旧状态只返回只读诊断和重新开始提示。

## 4. Plan Evidence 与返工

- [ ] 4.1 扩展 Plan Evidence 核对 Task/acceptance、repository/write scope、依赖、报告 owner、Host、Strategy、Binding 和 composition；运行越界/缺失 red-to-green tests。 <!-- comet-task:b1365a0b-4839-46b5-afce-f1edf4af3796 -->
      **Acceptance:** Plan Evidence 的 red-to-green 测试对每类缺失或越界输入 fail closed，完整输入才允许创建 Execute Work。
- [ ] 4.2 建立 Configure、Plan、Execute、Check、Verify→Build 和同摘要 fallback 矩阵，确认精确失效且无重复决定。 <!-- comet-task:5d6bb744-f0cc-40d3-9df1-303bc26a6ee5 -->
      **Acceptance:** 状态矩阵测试证明各类漂移只失效依赖旧输入的 Evidence/Work，Verify 返工与同摘要 fallback 不增加人工决定数量。

## 5. 观测与验收

- [ ] 5.1 增加 Strategy/Binding/Decision/Plan finding 的 Trajectory、OTLP、隐私、基数和离线复算测试。 <!-- comet-task:43579ae8-578e-44ad-bd3e-9521f776db05 -->
      **Acceptance:** 遥测测试覆盖全部新增事件、离线复算和有界枚举，并证明不会导出绝对路径、正文或高基数摘要片段。
- [ ] 5.2 更新 Desktop projection/UI，区分人工语义决定、自动 Binding 重验和历史复用/失效；运行 reducer、组件与 Windows 测试。 <!-- comet-task:993c22b8-3dd0-4c63-a740-0f6458135214 -->
      **Acceptance:** Reducer、组件与 Windows 测试证明当前有效决定只有一张待处理卡片，自动重验和历史决定具有不同的确定性展示状态。
- [ ] 5.3 更新文档，用真实单仓、多仓和跨 Runner 恢复执行 E2E，运行 `npm run spec:validate`、`npm run verify` 并生成正式验证报告。 <!-- comet-task:9773fc73-5b85-4c9d-bbbe-8da3f958b931 -->
      **Acceptance:** 文档命令可复现，三类 E2E、`npm run spec:validate` 与 `npm run verify` 全部成功，正式验证报告绑定最终提交和 Evidence。
