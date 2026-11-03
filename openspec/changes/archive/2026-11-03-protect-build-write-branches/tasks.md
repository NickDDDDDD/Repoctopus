# Tasks

## 1. 规格与红测

- [x] 1.1 严格校验 OpenSpec 四件套，确认 Plan 写集、受保护策略和恢复边界无冲突。
- [x] 1.2 先写领域红测，证明可写仓绑定 protected branch 被拒绝、只读仓不受影响、合法 source branch 通过。
- [x] 1.3 先写 Service 红测，证明拒绝发生在 Plan Outcome、Evidence、Execute Work、claim 和 Task completion 之前。
- [x] 1.4 写同 Run 恢复红测，证明 checkout 切换后通过 Binding revision 回到 Configure 而不是手改 Store。

## 2. 领域与配置实现

- [x] 2.1 提取唯一 protected branch pattern 纯函数，并让 Git Delivery checkpoint 复用。
- [x] 2.2 扩展 Change Run 输入和 CLI adapter，规范化并冻结 policy patterns 与 target branch。
- [x] 2.3 实现 Plan 写集与 Execution Binding 的领域校验、结构化 finding 和稳定 input digest。
- [x] 2.4 在 Plan Host submission 终态化前接入校验，确保失败不创建 Execute Work。

## 3. 恢复、可观测性与架构约束

- [x] 3.1 复用现有 Binding drift/reconfigure 入口并补足精确诊断，不新增 repair lifecycle 或 Git 副作用。
- [x] 3.2 为拒绝与恢复记录低基数 trajectory/OTLP 分类，验证 branch、path、pattern 不进入 Metric label。
- [x] 3.3 更新架构文档，明确 Runner 负责 prepare+push，Runtime 负责 observe+authorize。
- [x] 3.4 增加受保护 implementation 的精确直接前驱兼容声明，不建立通配迁移。

## 4. 验证与验收

- [x] 4.1 运行目标领域、Service、Delivery 和恢复测试，确认红测全部转绿。
- [x] 4.2 运行 typecheck、lint、architecture、严格 OpenSpec validation 和完整测试。
- [x] 4.3 在模拟多仓验收中先证明 main-bound 写集 fail closed，再创建并 push 三个业务 source branch，恢复同一 Run 至首个 Execute。
- [x] 4.4 保存正式验证结果，清理临时日志/scratch，提交、push、合入后继续剩余验收。
