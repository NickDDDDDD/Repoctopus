# Build 恢复设计讨论

## 已确认的范围

用户批准独立 Change `unify-build-workspace-recovery` 的 Open 产物。目标为统一 `resume` 与 `next` 的恢复判定，并在真实多仓项目验证新进程保留首包、未授权分支被阻断和切回后续跑。后续 Archive 与 Verify 问题在本 Change 验证合入后独立处理。

## 候选技术方案

采用用户指定并已批准的共用恢复判定。服务协调实时观察和受保护更新，领域层校验当前 Binding 和已接受的工作区 checkpoint。保留原工作包、计划及执行证据，未知 invocation 走已有恢复协议。判定覆盖两个入口返回当前 Work 或开始执行之前的边界。正式方案详见同一 Change 的 `design.md`，当前按用户批准的 autonomous、TDD、thorough 配置实施和验证。

## 方案取舍

- 单独给 `resume` 添加忽略启动快照 branch 差异的条件，无法保证未授权分支阻断与 `next` 一致。
- 每次恢复都重新 Configure 或重新 Plan，会使已接受的执行进度失效。
- 共用当前绑定与进度判定，复用现有 Run 更新与恢复机制，能保留进度并约束真实漂移，符合本次批准的范围。

## 关键实施约束

恢复判定不接受新的工作包结果、不改写启动快照、不根据分支命名推断授权。原 protected Plan correction 仍由精确授权控制。关联冲突的解除必须核对当前 Run 与原原因；并发恢复时不得用旧观察覆盖新状态。采用 Comet 0.5.1 的行为与验证方法，通过现有 Cordis、领域模块和 Git 适配器实现。

## 验证要求

独立 Builder Check 指出主规格的 `Binding-owned事实变化` 场景缺少授权边界。按用户已明确要求并在 Open 批准的未授权分支阻断行为，补充 `managed-work-execution` delta，限制自动 Configure 为可由批准意图与当前 Run 证据证明的兼容变化。原始 snapshot diff 与实际恢复操作也要分开，公开 CLI 续行提示取自有效 checkpoint 的恢复决定。

公开 CLI 的新进程对照验证、调用顺序互换、重复恢复、未授权分支、切回原 checkout、未知执行结果和未接受的 HEAD 均进入验收。真实多仓验收保存候选版本、命令结果、执行身份和 Git 引用，以正式报告记录结果。
